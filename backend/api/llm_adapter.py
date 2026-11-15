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

import inspect
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import RateLimitError

from . import retrieval

# backend/ locally, or the app's root when deployed as a Databricks App with
# source code path "backend" (api/ and LLM/ become top-level siblings then,
# so `from ..LLM import llm` would reach past the top-level package and
# fail). Put this directory on sys.path and import LLM absolutely instead,
# which works the same whether "api" is nested under backend/ or top-level.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Repo root locally; harmlessly finds nothing in a deployment, where env
# vars come from app.yaml / the Databricks Apps runtime instead.
load_dotenv(_BACKEND_DIR.parent / ".env")

from LLM import llm  # noqa: E402  (FAKE_LLM must be in os.environ before this import)

logger = logging.getLogger("rabbit_hole.llm_adapter")

# Stopgap, not a tuning target: prefetching all 3 tunnels generates ~3x
# what the player actually consumes, and that alone was enough to trip
# the workspace's shared QPS limit during real gameplay. Dropped to 1 --
# digging into tunnel 2 or 3 now falls back to live generation (slow, but
# it works) instead of never happening. Prefetch is being replaced by
# streaming entirely, so don't spend more effort tuning this further.
PREFETCH_TUNNEL_COUNT = 1
PREFETCH_STAGGER_SECONDS = 5.0

# Shared by every call into the model (generate_layer, cave_in, and the
# prefetch path): several people playing at once can trip the workspace's
# shared per-minute rate limit, and a transient 429 from that shouldn't
# surface as an error to the player who happened to hit it.
RATE_LIMIT_MAX_ATTEMPTS = 3  # 1 try + 2 retries
RATE_LIMIT_RETRY_BACKOFF_SECONDS = 1.5


def _with_rate_limit_retry(fn, *args, **kwargs):
    for attempt in range(1, RATE_LIMIT_MAX_ATTEMPTS + 1):
        try:
            return fn(*args, **kwargs)
        except RateLimitError as exc:
            if attempt == RATE_LIMIT_MAX_ATTEMPTS:
                raise
            delay = RATE_LIMIT_RETRY_BACKOFF_SECONDS * attempt
            logger.info("rate-limited (attempt %d/%d), retrying in %.1fs: %s",
                        attempt, RATE_LIMIT_MAX_ATTEMPTS, delay, exc)
            time.sleep(delay)


# llm.py has no direct toggle for the blind check (check_question() runs it
# whenever depth >= BLIND_CHECK_FROM_DEPTH, with no parameter to skip it).
# The lever it does expose: generate_question(explanation, depth, ...) takes
# depth as a plain argument, and BLIND_CHECK_FROM_DEPTH is a public (non-
# underscore) constant -- so asking for the question at a depth just below
# that threshold skips the blind check without touching her file. This also
# asks for that depth's (slightly easier) question difficulty tier, which is
# an accepted side effect, not a separate knob: a slightly weaker question
# beats a dead run.
_RELAXED_QUESTION_DEPTH = llm.BLIND_CHECK_FROM_DEPTH - 1


def _generate_layer_relaxed(topic: str, path: list, depth: int) -> dict:
    """Last resort after generate_layer() exhausts its retries: rebuild the
    layer from llm.py's public pieces, asking only the question for a
    reduced depth so check_question() skips the blind check. Explanation
    and artifact/tunnels still use the real depth."""
    explanation = "".join(llm.generate_explanation(topic, path, depth)).strip()
    question = llm.generate_question(explanation, min(depth, _RELAXED_QUESTION_DEPTH))
    details = llm.generate_details(topic, path, depth, explanation)
    return {
        "topic": topic,
        "depth": depth,
        "explanation": explanation,
        "question": question,
        "artifact": details["artifact"],
        "tunnels": details["tunnels"],
    }


def _cave_in_relaxed(layer: dict, chosen_index: int, attempt: int) -> dict:
    """Same fallback, for a cave-in's re-explanation and question."""
    style = llm.cave_in_style(attempt)
    explanation = "".join(llm.generate_cave_in_explanation(layer, chosen_index, attempt)).strip()
    depth = layer.get("depth", 1)
    question = llm.generate_question(
        explanation, min(depth, _RELAXED_QUESTION_DEPTH),
        missed_question=layer["question"]["text"],
    )
    return {"explanation": explanation, "style": style, "question": question}


# Ruby is adding an optional `passages` argument to her generate_layer on
# her own schedule; checked once at import time so every call site below
# starts passing retrieved passages the moment it exists, with no further
# changes needed here, and never breaks while it doesn't.
_GENERATE_LAYER_TAKES_PASSAGES = "passages" in inspect.signature(llm.generate_layer).parameters

# Retrieval runs in its own thread, started before generation. While her
# generate_layer doesn't consume passages yet, there's no data dependency
# between the two, so this overlaps the Vector Search query (and an
# occasional live Wikipedia fetch on a miss) with generation instead of
# paying for both back to back -- generation (several seconds) dominates
# retrieval (well under a second on a hit), so this hides it almost
# entirely. The moment passages is required as an input, the code below
# blocks on this future before calling generate_layer, so it automatically
# reverts to the correct sequential order with no further changes needed.
_retrieval_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="retrieval")


def _call_generate_layer(topic: str, path: list, depth: int) -> dict:
    retrieval_future = _retrieval_pool.submit(retrieval.retrieve, topic)

    def _generate():
        if not _GENERATE_LAYER_TAKES_PASSAGES:
            return llm.generate_layer(topic=topic, path=path, depth=depth)
        return llm.generate_layer(
            topic=topic, path=path, depth=depth, passages=retrieval_future.result()
        )

    try:
        return _with_rate_limit_retry(_generate)
    except RuntimeError:
        logger.warning(
            "generate_layer exhausted its retries for %r depth %d; "
            "retrying once with the blind check skipped", topic, depth
        )
        return _with_rate_limit_retry(_generate_layer_relaxed, topic, path, depth)


def generate_layer(topic: str, path: list, depth: int) -> dict:
    """Returns their raw layer dict (topic, depth, explanation, question, artifact, tunnels).
    Retrieves grounding passages for the topic and passes them through if
    their generate_layer accepts a `passages` argument. Retries on a
    transient rate limit before giving up, and once more with the blind
    check skipped if generation itself keeps failing -- a weaker question
    beats killing the run."""
    return _call_generate_layer(topic, path, depth)


def cave_in(layer: dict, chosen_index: int, attempt: int) -> dict:
    """Returns their raw result dict (explanation, style, question).
    Retries on a transient rate limit, and once more with the blind check
    skipped if generation itself keeps failing, before giving up."""
    try:
        return _with_rate_limit_retry(
            llm.cave_in, layer=layer, chosen_index=chosen_index, attempt=attempt
        )
    except RuntimeError:
        logger.warning(
            "cave_in exhausted its retries for %r; retrying once with the "
            "blind check skipped", layer.get("topic")
        )
        return _with_rate_limit_retry(_cave_in_relaxed, layer, chosen_index, attempt)


def _prefetch_one(tunnel: str, path: list, depth: int, start_delay: float) -> dict:
    time.sleep(start_delay)
    try:
        return _call_generate_layer(tunnel, path, depth)
    except Exception:
        # Best-effort prefetch: dig_run already falls back to generating
        # this tunnel live if it's missing here, so give up quietly after
        # _call_generate_layer's own rate-limit retries are exhausted
        # rather than retrying again on top of them.
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
