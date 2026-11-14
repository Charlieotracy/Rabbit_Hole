"""Retrieval layer: grounding passages for a topic.

Queries the wikipedia_passages Vector Search index first. If the best
match is too weak (or the index can't be reached), fetches the topic from
Wikipedia live instead, writes the result into the Delta table, and
returns that -- so the corpus grows as people play.

Same Wikipedia-fetching approach as notebooks/wikipedia_corpus.py, kept
self-contained here rather than imported from notebooks/, since a
Databricks App deployed from backend/ won't have notebooks/ alongside it.
"""

import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

from . import storage

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger("rabbit_hole.retrieval")

DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST")
DATABRICKS_TOKEN = os.environ.get("DATABRICKS_TOKEN")
VECTOR_SEARCH_ENABLED = bool(DATABRICKS_HOST and DATABRICKS_TOKEN)
if not VECTOR_SEARCH_ENABLED:
    logger.warning("DATABRICKS_HOST/DATABRICKS_TOKEN not set; retrieval will go straight to Wikipedia.")

VECTOR_SEARCH_ENDPOINT_NAME = "rabbit_hole_vector_search"
INDEX_NAME = "workspace.default.wikipedia_passages_index"

# Below this, the best Vector Search match is too weak to use as grounding.
# Calibrated empirically against this index with topic-style queries --
# what retrieve() is actually called with, e.g. "black hole", not a full
# question. Topics genuinely in the corpus scored 0.66-0.79; unrelated
# topics scored 0.47-0.57. (A full-sentence question like "what happens
# when you cross a black hole's event horizon" scores lower against the
# same passages than a short topic phrase does -- this threshold is tuned
# for topics, not sentences.)
MISS_SCORE_THRESHOLD = 0.60

WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"
USER_AGENT = (
    "RabbitHoleCorpusFetcher/1.0 "
    "(hackathon educational project; https://github.com/Charlieotracy/Rabbit_Hole)"
)
REQUEST_PAUSE_SECONDS = 0.5
REQUEST_RETRIES = 2
PARAGRAPHS_PER_PASSAGE = 2
MAX_PASSAGES_PER_ARTICLE = 12

_SECTION_HEADING_RE = re.compile(r"^=+\s*.+?\s*=+$")

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT})

_vs_client = None


def _get_vector_search_client():
    global _vs_client
    if _vs_client is None:
        from databricks.vector_search.client import VectorSearchClient

        _vs_client = VectorSearchClient(
            workspace_url=f"https://{DATABRICKS_HOST}",
            personal_access_token=DATABRICKS_TOKEN,
            disable_notice=True,
        )
    return _vs_client


def _query_vector_search(topic: str, k: int) -> list:
    """Returns rows of [passage_text, article_title, article_url, score],
    best match first; [] if the index couldn't be reached."""
    try:
        client = _get_vector_search_client()
        index = client.get_index(VECTOR_SEARCH_ENDPOINT_NAME, INDEX_NAME)
        result = index.similarity_search(
            query_text=topic,
            columns=["passage_text", "article_title", "article_url"],
            num_results=k,
        )
        return result.get("result", {}).get("data_array", [])
    except Exception:
        logger.exception("Vector Search query failed for %r", topic)
        return []


# ------------------------------------------------- Wikipedia live fallback

def _wiki_get(params: dict) -> dict:
    params = {**params, "format": "json"}
    last_exc = None
    for attempt in range(REQUEST_RETRIES + 1):
        try:
            resp = _session.get(WIKIPEDIA_API_URL, params=params, timeout=15)
            resp.raise_for_status()
            time.sleep(REQUEST_PAUSE_SECONDS)
            return resp.json()
        except requests.RequestException as exc:
            last_exc = exc
            time.sleep(1.0 * (attempt + 1))
    raise last_exc


def _search_title(topic: str) -> Optional[str]:
    try:
        data = _wiki_get({"action": "query", "list": "search", "srsearch": topic, "srlimit": 1})
    except requests.RequestException as exc:
        logger.warning("Wikipedia search failed for %r: %s", topic, exc)
        return None
    hits = data.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def _fetch_article(title: str) -> Optional[dict]:
    try:
        data = _wiki_get(
            {
                "action": "query",
                "titles": title,
                "prop": "extracts|info",
                "explaintext": 1,
                "inprop": "url",
                "redirects": 1,
            }
        )
    except requests.RequestException as exc:
        logger.warning("Wikipedia fetch failed for %r: %s", title, exc)
        return None
    page = next(iter(data.get("query", {}).get("pages", {}).values()), None)
    if page is None or "missing" in page:
        return None
    return {
        "title": page.get("title", title),
        "url": page.get("fullurl", f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"),
        "text": page.get("extract", ""),
    }


def _split_into_passages(text: str) -> list:
    paragraphs = [
        p.strip()
        for p in text.split("\n")
        if p.strip() and not _SECTION_HEADING_RE.match(p.strip())
    ]
    passages = []
    for i in range(0, len(paragraphs), PARAGRAPHS_PER_PASSAGE):
        group = paragraphs[i : i + PARAGRAPHS_PER_PASSAGE]
        passages.append("\n\n".join(group))
    return passages[:MAX_PASSAGES_PER_ARTICLE]


def _fetch_from_wikipedia(topic: str) -> list:
    """Live fallback for a retrieval miss: search, fetch, split, persist.
    Returns [] on any failure (including no network, e.g. in a Databricks
    deployment, which can't reach the public internet) rather than raising."""
    title = _search_title(topic)
    if title is None:
        logger.info("No Wikipedia match for %r", topic)
        return []

    article = _fetch_article(title)
    if article is None:
        logger.info("Could not fetch Wikipedia article %r", title)
        return []

    passages = _split_into_passages(article["text"])
    rows = [
        {
            "passage_text": passage,
            "article_title": article["title"],
            "article_url": article["url"],
            "source": "wikipedia",
        }
        for passage in passages
    ]
    storage.record_wikipedia_passages(rows)
    return [
        {"text": r["passage_text"], "article_title": r["article_title"], "article_url": r["article_url"]}
        for r in rows
    ]


def retrieve(topic: str, k: int = 3) -> list:
    """Returns up to k passages: [{text, article_title, article_url}, ...].

    A Vector Search miss (weak best score, empty index result, or the
    index being unreachable) falls back to fetching the topic from
    Wikipedia live and persisting it, so the corpus grows as people play.
    """
    rows = _query_vector_search(topic, k) if VECTOR_SEARCH_ENABLED else []
    best_score = rows[0][-1] if rows else 0.0

    if rows and best_score >= MISS_SCORE_THRESHOLD:
        return [{"text": r[0], "article_title": r[1], "article_url": r[2]} for r in rows]

    logger.info("Retrieval miss for %r (best score %.3f); fetching from Wikipedia", topic, best_score)
    return _fetch_from_wikipedia(topic)[:k]
