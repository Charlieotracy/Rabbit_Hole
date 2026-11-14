"""Adapts the LLM team's content shapes to this API's shapes.

Their functions (backend/LLM/llm.py) are called here unchanged; this module
only translates field names so the rest of the API never has to know them:
  explanation            -> layer
  question.text          -> question
  question.options       -> options
  question.answer_index  -> correct_index (kept server-side, never returned)
  artifact {name, icon}  -> kept as-is, plus our own `depth`
  cave_in() result       -> {layer, question, options, style}
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import RateLimitError

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from ..LLM import llm  # noqa: E402  (FAKE_LLM must be in os.environ before this import)

logger = logging.getLogger("rabbit_hole.llm_adapter")

# llm.generate_ahead() fires all 3 tunnels at once, each making up to 2 model
# calls (ask_model + the checker) -- 6 simultaneous calls, which trips
# Databricks' free-tier QPS limit (429 REQUEST_LIMIT_EXCEEDED) and is
# all-or-nothing: one rate-limited tunnel discards the other two's results.
# We stagger each tunnel's start and retry a rate-limited one with a short
# backoff instead, so occasional 429s get absorbed instead of losing layers.
PREFETCH_TUNNEL_COUNT = 3
PREFETCH_STAGGER_SECONDS = 1.5
PREFETCH_RETRY_BACKOFF_SECONDS = 1.5
PREFETCH_MAX_ATTEMPTS = 3  # 1 try + 2 retries


def generate_layer(topic: str, path: list, depth: int) -> dict:
    """Returns their raw layer dict (topic, depth, explanation, question, artifact, tunnels)."""
    return llm.generate_layer(topic=topic, path=path, depth=depth)


def cave_in(layer: dict, chosen_index: int, attempt: int) -> dict:
    """Returns their raw result dict (explanation, style, question)."""
    return llm.cave_in(layer=layer, chosen_index=chosen_index, attempt=attempt)


def _prefetch_one(tunnel: str, path: list, depth: int, start_delay: float) -> dict:
    time.sleep(start_delay)
    for attempt in range(1, PREFETCH_MAX_ATTEMPTS + 1):
        try:
            return llm.generate_layer(topic=tunnel, path=path, depth=depth)
        except RateLimitError:
            if attempt == PREFETCH_MAX_ATTEMPTS:
                logger.warning("prefetch for %r still rate-limited after %d tries", tunnel, attempt)
                return None
            logger.info("prefetch for %r rate-limited, retrying (attempt %d)", tunnel, attempt)
            time.sleep(PREFETCH_RETRY_BACKOFF_SECONDS * attempt)
        except Exception:
            logger.exception("prefetch for %r failed", tunnel)
            return None


def generate_ahead(path: list, depth: int, tunnels: list) -> dict:
    """Pre-generates a subset of the tunnels' next layers (staggered, with
    429 retry) instead of all of them at once. Returns {tunnel_name: raw
    layer dict}; a tunnel this skips or fails is left out and generated
    live by the caller when it's actually dug into.
    """
    chosen = tunnels[:PREFETCH_TUNNEL_COUNT]
    results = {}
    with ThreadPoolExecutor(max_workers=len(chosen)) as pool:
        futures = {
            pool.submit(_prefetch_one, tunnel, path, depth, i * PREFETCH_STAGGER_SECONDS): tunnel
            for i, tunnel in enumerate(chosen)
        }
        for future, tunnel in futures.items():
            layer = future.result()
            if layer is not None:
                results[tunnel] = layer
    return results


def turn_view(explanation: str, question: dict) -> dict:
    return {
        "layer": explanation,
        "question": question["text"],
        "options": question["options"],
    }


def artifact_view(artifact: dict, depth: int) -> dict:
    return {"name": artifact["name"], "icon": artifact["icon"], "depth": depth}


def cave_in_view(result: dict) -> dict:
    return {
        "layer": result["explanation"],
        "question": result["question"]["text"],
        "options": result["question"]["options"],
        "style": result["style"],
    }
