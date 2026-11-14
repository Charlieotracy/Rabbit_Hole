"""Fetches a small Wikipedia text corpus for offline testing.

Runs on your own laptop, not in Databricks -- their outbound network is
restricted and can't reach Wikipedia.

For each seed topic: search Wikipedia for the best-matching article, pull
its plain text and the titles of articles it links to, and split the text
into ~2-paragraph passages. Then do the same one level deeper for a
handful of each seed's linked articles (no further recursion). Writes
notebooks/wikipedia_corpus.csv with columns:
  passage_text, article_title, article_url, source
"""

import csv
import re
import time
import urllib.parse
from pathlib import Path
from typing import Optional

import requests

API_URL = "https://en.wikipedia.org/w/api.php"

# Wikipedia asks scripted clients to identify themselves. Swap in a contact
# email if you want one in here -- left out since it'd otherwise go out to
# an external service without being asked first.
USER_AGENT = (
    "RabbitHoleCorpusFetcher/1.0 "
    "(hackathon educational project; https://github.com/Charlieotracy/Rabbit_Hole)"
)

REQUEST_PAUSE_SECONDS = 0.5  # politeness delay between requests
REQUEST_RETRIES = 2

PARAGRAPHS_PER_PASSAGE = 2
MAX_PASSAGES_PER_ARTICLE = 12  # keeps the corpus spread across many topics
LINKS_TO_FOLLOW_PER_TOPIC = 3  # how many of each seed's links to also fetch

OUTPUT_PATH = Path(__file__).resolve().parent / "wikipedia_corpus.csv"

SEED_TOPICS = [
    "Black hole",
    "Photosynthesis",
    "Roman Empire",
    "Jazz",
    "Quantum entanglement",
    "Renaissance",
    "DNA",
    "World War II",
    "Volcano",
    "French Revolution",
]

_SECTION_HEADING_RE = re.compile(r"^=+\s*.+?\s*=+$")
_WIKILINK_HREF_RE = re.compile(r'<a\s+[^>]*href="/wiki/([^"#]+)"')
_SKIP_NAMESPACES = {
    "File", "Help", "Category", "Template", "Wikipedia", "Portal",
    "Special", "Talk", "User", "Module", "Draft", "TimedText",
}

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT})


def _get(params: dict) -> dict:
    params = {**params, "format": "json"}
    last_exc = None
    for attempt in range(REQUEST_RETRIES + 1):
        try:
            resp = _session.get(API_URL, params=params, timeout=15)
            resp.raise_for_status()
            time.sleep(REQUEST_PAUSE_SECONDS)
            return resp.json()
        except requests.RequestException as exc:
            last_exc = exc
            time.sleep(1.0 * (attempt + 1))
    raise last_exc


def search_title(topic: str) -> Optional[str]:
    """Best-matching article title for a free-text topic, or None if nothing matched."""
    try:
        data = _get({"action": "query", "list": "search", "srsearch": topic, "srlimit": 1})
    except requests.RequestException as exc:
        print(f"  (search failed for {topic!r}: {exc})")
        return None
    hits = data.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def fetch_article(title: str) -> Optional[dict]:
    """Plain text and canonical URL for one article."""
    try:
        data = _get(
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
        print(f"  (fetch failed for {title!r}: {exc})")
        return None

    page = next(iter(data.get("query", {}).get("pages", {}).values()), None)
    if page is None or "missing" in page:
        return None
    return {
        "title": page.get("title", title),
        "url": page.get("fullurl", f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"),
        "text": page.get("extract", ""),
    }


def fetch_intro_links(title: str) -> list:
    """Titles linked from the article's lead section, in reading order.

    `prop=links` (the obvious choice) returns links alphabetically, which
    for "follow one level deeper" gives essentially random trivia instead
    of the concepts the article actually opens with. Parsing the lead
    section's real HTML keeps the order links actually appear in.
    """
    try:
        data = _get({"action": "parse", "page": title, "prop": "text", "section": 0, "redirects": 1})
    except requests.RequestException as exc:
        print(f"  (intro-links fetch failed for {title!r}: {exc})")
        return []

    html = data.get("parse", {}).get("text", {}).get("*", "")
    links = []
    seen = set()
    for href in _WIKILINK_HREF_RE.findall(html):
        namespace = href.split(":", 1)[0] if ":" in href else None
        if namespace in _SKIP_NAMESPACES:
            continue
        link_title = urllib.parse.unquote(href).replace("_", " ")
        # The "For other uses, see X (disambiguation)" hatnote is almost
        # always the first link in section 0, ahead of any real body text,
        # and the page itself is just a bare list of unrelated meanings.
        if "(disambiguation)" in link_title.lower():
            continue
        if link_title not in seen:
            seen.add(link_title)
            links.append(link_title)
    return links


def split_into_passages(text: str) -> list:
    """Groups the article's paragraphs into ~2-paragraph passages, dropping
    section headings (`== Heading ==`) and blank lines."""
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


def fetch_passages(title: str, seen_titles: set) -> list:
    """Returns rows for one article; [] if already seen or unfetchable."""
    if title in seen_titles:
        return []

    article = fetch_article(title)
    if article is None:
        seen_titles.add(title)
        print(f"  (skipped, no such article: {title!r})")
        return []

    # Two different link titles can redirect to the same canonical page
    # (e.g. "Double helix" -> "Nucleic acid double helix"); without this,
    # that page's passages would get written out twice. Checked before
    # adding `title` itself, so a fresh, non-redirected fetch never
    # matches against its own about-to-be-added entry.
    if article["title"] in seen_titles:
        seen_titles.add(title)
        print(f"  ({title!r} redirects to already-fetched {article['title']!r}, skipping)")
        return []
    seen_titles.add(title)
    seen_titles.add(article["title"])

    passages = split_into_passages(article["text"])
    rows = [
        {
            "passage_text": passage,
            "article_title": article["title"],
            "article_url": article["url"],
            "source": "wikipedia",
        }
        for passage in passages
    ]
    print(f"  {article['title']!r}: {len(rows)} passages")
    return rows


def build_corpus(seed_topics) -> list:
    rows = []
    seen_titles = set()
    for topic in seed_topics:
        print(f"Seed topic: {topic!r}")
        title = search_title(topic)
        if title is None:
            print(f"  (no Wikipedia match for {topic!r})")
            continue

        rows.extend(fetch_passages(title, seen_titles))

        links = fetch_intro_links(title)
        print(f"  -> following {min(len(links), LINKS_TO_FOLLOW_PER_TOPIC)} of {len(links)} intro links")
        for linked_title in links[:LINKS_TO_FOLLOW_PER_TOPIC]:
            rows.extend(fetch_passages(linked_title, seen_titles))
    return rows


def write_csv(rows: list, path: Path = OUTPUT_PATH) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["passage_text", "article_title", "article_url", "source"]
        )
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    rows = build_corpus(SEED_TOPICS)
    write_csv(rows)
    print(f"\nWrote {len(rows)} passages to {OUTPUT_PATH}")
