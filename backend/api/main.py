import json
import logging
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openai import RateLimitError
from pydantic import BaseModel

from . import llm_adapter, storage

logger = logging.getLogger("rabbit_hole.api")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNS: Dict[str, dict] = {}

_MAP_FIELDS = ("id", "parent_id", "topic", "depth", "status", "cave_ins")


@app.on_event("startup")
def _startup() -> None:
    storage.init_tables()


class RunRequest(BaseModel):
    topic: str
    stream: bool = False


class AnswerRequest(BaseModel):
    option_index: int
    stream: bool = False


class DigRequest(BaseModel):
    tunnel_index: int


def _get_run(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _friendly_message(exc: Exception) -> str:
    if isinstance(exc, RateLimitError):
        return "The tunnel's busy — give it a moment and try again."
    return "That tunnel collapsed. Try again?"


def _llm_error(exc: Exception) -> JSONResponse:
    # The real exception (raw Databricks/openai error JSON included) is
    # logged here for debugging and never sent to the player -- they get
    # a short, in-theme message instead.
    logger.exception("LLM generation call failed")
    return JSONResponse(status_code=503, content={"error": _friendly_message(exc)})


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def _map_entry(node: dict) -> dict:
    return {field: node[field] for field in _MAP_FIELDS}


def _start_prefetch(run: dict, node: dict) -> None:
    """Kicks off generate_ahead for `node`'s tunnels in the background, as
    soon as the layer exists -- its tunnels are already known then, well
    before the player has even answered, let alone correctly. The player
    then spends 20-40s reading, answering, and maybe caving in, which is
    normally plenty of time for all three to land in run["pending_layers"]
    before they actually reach /dig or a correct /answer.

    `node["id"]` is used as a token: if a dig happens before an earlier
    prefetch (for a node the run has since moved past) finishes, that
    stale result must not land in pending_layers over a newer one, so a
    late finisher checks the token is still current before writing."""
    tunnels = node["raw_layer"]["tunnels"]
    depth = node["depth"] + 1
    token = node["id"]
    run["pending_layers"] = {}
    run["_prefetch_token"] = token

    def work():
        try:
            result = llm_adapter.generate_ahead(path=run["path"], depth=depth, tunnels=tunnels)
        except Exception:
            logger.exception("generate_ahead prefetch failed; dig will fall back to live generation")
            result = {}
        if run.get("_prefetch_token") == token:
            run["pending_layers"] = result
        else:
            logger.info("discarding stale prefetch for %r; run has moved past it", node["topic"])

    threading.Thread(target=work, daemon=True).start()


def _attach_streamed_node(run_id: str, run: dict, pending: dict, raw_layer: dict) -> dict:
    """Finishes what create_run (or, later, dig_run) would have done
    synchronously: builds the node from a layer that was just streamed,
    drops it into the run exactly like the non-streaming path does, and
    kicks off the same prefetch. Returns the new node."""
    node_id = pending["node_id"]
    node = {
        "id": node_id,
        "parent_id": pending["parent_id"],
        "topic": raw_layer["topic"],
        "depth": pending["depth"],
        "status": "dug",
        "cave_ins": 0,
        "raw_layer": raw_layer,
        "question": raw_layer["question"],
    }
    run["nodes"][node_id] = node
    run["node_order"].append(node_id)
    run["current_node_id"] = node_id
    run["path"].append(raw_layer["topic"])
    run.pop("_pending_stream", None)

    if pending["parent_id"] is None:  # this is the run's root layer
        run["topic"] = raw_layer["topic"]
        storage.record_run_start(run_id, raw_layer["topic"])

    _start_prefetch(run, node)
    return node


@app.post("/runs")
def create_run(body: RunRequest):
    if body.stream:
        run_id = str(uuid.uuid4())
        RUNS[run_id] = {
            "topic": body.topic,
            "depth": 1,
            "tunnels": None,
            "pending_layers": {},
            "artifacts": [],
            "nodes": {},
            "node_order": [],
            "current_node_id": None,
            "cleared_node_ids": set(),
            "next_node_num": 2,
            "path": [],
            "_pending_stream": {
                "node_id": "n1", "parent_id": None, "topic": body.topic, "path": [], "depth": 1,
            },
        }
        return {"run_id": run_id, "depth": 1, "topic": body.topic}

    try:
        raw_layer = llm_adapter.generate_layer(topic=body.topic, path=[], depth=1)
    except Exception as exc:
        return _llm_error(exc)

    run_id = str(uuid.uuid4())
    root_id = "n1"
    root_node = {
        "id": root_id,
        "parent_id": None,
        "topic": raw_layer["topic"],
        "depth": 1,
        "status": "dug",
        "cave_ins": 0,
        "raw_layer": raw_layer,
        "question": raw_layer["question"],
    }
    RUNS[run_id] = {
        "topic": raw_layer["topic"],
        "depth": 1,
        "tunnels": None,
        "pending_layers": {},
        "artifacts": [],
        "nodes": {root_id: root_node},
        "node_order": [root_id],
        "current_node_id": root_id,
        "cleared_node_ids": set(),
        "next_node_num": 2,
        "path": [raw_layer["topic"]],
    }
    storage.record_run_start(run_id, raw_layer["topic"])
    _start_prefetch(RUNS[run_id], root_node)
    return {
        "run_id": run_id,
        "depth": 1,
        "topic": raw_layer["topic"],
        "turn": llm_adapter.turn_view(raw_layer["explanation"], root_node["question"]),
    }


@app.get("/runs/{run_id}/layer")
def stream_layer(run_id: str):
    run = _get_run(run_id)
    pending = run.get("_pending_stream")
    if pending is None:
        raise HTTPException(status_code=400, detail="no layer generation pending for this run")

    def events():
        topic, path, depth = pending["topic"], pending["path"], pending["depth"]
        explanation_parts = []
        try:
            for chunk in llm_adapter.generate_explanation(topic, path, depth):
                explanation_parts.append(chunk)
                yield _sse("text", {"delta": chunk})
        except Exception as exc:
            logger.exception("streamed explanation failed")
            yield _sse("error", {"error": _friendly_message(exc), "explanation_shown": bool(explanation_parts)})
            return

        explanation = "".join(explanation_parts).strip()
        yield _sse("explanation_committed", {"text": explanation})

        try:
            # Independent of each other -- same parallel pattern her own
            # non-streaming generate_layer() uses for this step.
            with ThreadPoolExecutor(max_workers=2) as pool:
                question_future = pool.submit(llm_adapter.generate_question, explanation, depth)
                details_future = pool.submit(
                    llm_adapter.generate_details, topic, path, depth, explanation
                )
                question, details = question_future.result(), details_future.result()
        except Exception as exc:
            logger.exception("streamed question/details failed")
            yield _sse("error", {"error": _friendly_message(exc), "explanation_shown": True})
            return

        raw_layer = {
            "topic": topic,
            "depth": depth,
            "explanation": explanation,
            "question": question,
            "artifact": details["artifact"],
            "tunnels": details["tunnels"],
        }
        _attach_streamed_node(run_id, run, pending, raw_layer)

        yield _sse("question", llm_adapter.question_view(question))
        yield _sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/runs/{run_id}/answer")
def answer_run(run_id: str, body: AnswerRequest):
    run = _get_run(run_id)
    node = run["nodes"][run["current_node_id"]]
    question = node["question"]
    if not 0 <= body.option_index < len(question["options"]):
        raise HTTPException(status_code=400, detail="option_index out of range")

    if body.option_index == question["answer_index"]:
        run["cleared_node_ids"].add(node["id"])
        artifact = llm_adapter.artifact_view(node["raw_layer"]["artifact"], node["depth"])
        run["artifacts"].append(artifact)
        tunnels = node["raw_layer"]["tunnels"]
        run["tunnels"] = tunnels
        storage.record_answer(
            run_id, node["id"], node["topic"], node["depth"], body.option_index, True
        )
        # The prefetch for these tunnels was already kicked off in the
        # background back when this layer was created (create_run or
        # dig_run) -- nothing to wait on here, so this returns immediately.
        return {"correct": True, "artifact": artifact, "tunnels": tunnels}

    attempt = node["cave_ins"]  # 0-based, before incrementing
    # Recorded unconditionally and up front: they answered wrong regardless
    # of whether a re-explanation can be generated for it.
    storage.record_answer(
        run_id, node["id"], node["topic"], node["depth"], body.option_index, False
    )

    if body.stream:
        run["_pending_cave_in"] = {
            "node_id": node["id"],
            # Same fix as the non-streaming path below: keep explanation/
            # topic/etc. from the original layer, swap in the current
            # question (what the player actually just answered).
            "layer": {**node["raw_layer"], "question": node["question"]},
            "chosen_index": body.option_index,
            "attempt": attempt,
        }
        return {"correct": False}

    try:
        # node["raw_layer"]["question"] is always the FIRST question, but
        # chosen_index refers to the CURRENT question's options -- on a
        # second cave-in that would tell the model the wrong question and
        # the wrong chosen answer. Keep explanation/topic/etc. from the
        # original layer (re-explain the same idea), swap in the current
        # question (what the player actually just answered).
        result = llm_adapter.cave_in(
            layer={**node["raw_layer"], "question": node["question"]},
            chosen_index=body.option_index,
            attempt=attempt,
        )
    except Exception as exc:
        return _llm_error(exc)

    node["cave_ins"] += 1
    node["question"] = result["question"]
    storage.record_cave_in(run_id, node["id"], node["topic"], node["depth"], node["cave_ins"])
    return {"correct": False, "cave_in": llm_adapter.cave_in_view(result)}


@app.get("/runs/{run_id}/cave-in")
def stream_cave_in(run_id: str):
    run = _get_run(run_id)
    pending = run.get("_pending_cave_in")
    if pending is None:
        raise HTTPException(status_code=400, detail="no cave-in pending for this run")

    def events():
        layer = pending["layer"]
        chosen_index, attempt = pending["chosen_index"], pending["attempt"]
        style = llm_adapter.cave_in_style(attempt)
        explanation_parts = []
        try:
            for chunk in llm_adapter.generate_cave_in_explanation(layer, chosen_index, attempt):
                explanation_parts.append(chunk)
                yield _sse("text", {"delta": chunk})
        except Exception as exc:
            logger.exception("streamed cave-in explanation failed")
            yield _sse(
                "error",
                {"error": _friendly_message(exc), "explanation_shown": bool(explanation_parts)},
            )
            return

        explanation = "".join(explanation_parts).strip()
        yield _sse("explanation_committed", {"text": explanation})

        try:
            question = llm_adapter.generate_question(
                explanation, layer.get("depth", 1), missed_question=layer["question"]["text"]
            )
        except Exception as exc:
            logger.exception("streamed cave-in question failed")
            yield _sse("error", {"error": _friendly_message(exc), "explanation_shown": True})
            return

        node = run["nodes"][pending["node_id"]]
        node["cave_ins"] += 1
        node["question"] = question
        storage.record_cave_in(run_id, node["id"], node["topic"], node["depth"], node["cave_ins"])
        run.pop("_pending_cave_in", None)

        yield _sse("question", llm_adapter.cave_in_question_view(question, style))
        yield _sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/runs/{run_id}/dig")
def dig_run(run_id: str, body: DigRequest):
    run = _get_run(run_id)
    tunnels = run["tunnels"]
    if not tunnels:
        raise HTTPException(status_code=400, detail="answer correctly before digging")
    if not 0 <= body.tunnel_index < len(tunnels):
        raise HTTPException(status_code=400, detail="tunnel_index out of range")

    parent_node = run["nodes"][run["current_node_id"]]
    new_depth = parent_node["depth"] + 1
    chosen_tunnel = tunnels[body.tunnel_index]

    raw_layer = run["pending_layers"].get(chosen_tunnel)
    if raw_layer is None:
        try:
            raw_layer = llm_adapter.generate_layer(
                topic=chosen_tunnel, path=run["path"], depth=new_depth
            )
        except Exception as exc:
            return _llm_error(exc)

    chosen_node = None
    for i, tunnel_topic in enumerate(tunnels):
        node_id = f"n{run['next_node_num']}"
        run["next_node_num"] += 1
        if i == body.tunnel_index:
            node = {
                "id": node_id,
                "parent_id": parent_node["id"],
                "topic": raw_layer["topic"],
                "depth": new_depth,
                "status": "dug",
                "cave_ins": 0,
                "raw_layer": raw_layer,
                "question": raw_layer["question"],
            }
            chosen_node = node
        else:
            node = {
                "id": node_id,
                "parent_id": parent_node["id"],
                "topic": tunnel_topic,
                "depth": new_depth,
                "status": "skipped",
                "cave_ins": 0,
            }
        run["nodes"][node_id] = node
        run["node_order"].append(node_id)

    run["current_node_id"] = chosen_node["id"]
    run["depth"] = new_depth
    run["tunnels"] = None
    run["path"].append(chosen_node["topic"])
    _start_prefetch(run, chosen_node)

    return {
        "depth": new_depth,
        "topic": chosen_node["topic"],
        "turn": llm_adapter.turn_view(
            chosen_node["raw_layer"]["explanation"], chosen_node["question"]
        ),
    }


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = _get_run(run_id)
    nodes = run["nodes"]
    layers_cleared = len(run["artifacts"])
    first_try_count = sum(
        1
        for node_id in run["cleared_node_ids"]
        if nodes[node_id]["cave_ins"] == 0
    )

    storage.record_run_end(run_id, run["depth"], first_try_count)

    return {
        "topic": run["topic"],
        "depth": run["depth"],
        "layers_cleared": layers_cleared,
        "first_try_count": first_try_count,
        "artifacts": run["artifacts"],
        "map": [_map_entry(nodes[node_id]) for node_id in run["node_order"]],
    }


if __name__ == "__main__":
    import uvicorn

    # Databricks Apps sets this and expects a 0.0.0.0 bind (same convention
    # backend/LLM/app.py already uses).
    port = int(os.environ.get("DATABRICKS_APP_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
