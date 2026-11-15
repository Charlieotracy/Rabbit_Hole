import logging
import os
import uuid
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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


class AnswerRequest(BaseModel):
    option_index: int


class DigRequest(BaseModel):
    tunnel_index: int


def _get_run(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _llm_error(exc: Exception) -> JSONResponse:
    logger.exception("LLM generation call failed")
    return JSONResponse(status_code=503, content={"error": str(exc)})


def _map_entry(node: dict) -> dict:
    return {field: node[field] for field in _MAP_FIELDS}


@app.post("/runs")
def create_run(body: RunRequest):
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
    return {
        "run_id": run_id,
        "depth": 1,
        "topic": raw_layer["topic"],
        "turn": llm_adapter.turn_view(raw_layer["explanation"], root_node["question"]),
    }


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
        # Pre-generate the next layer for all three tunnels in parallel so
        # digging feels instant; any tunnel this misses (including all three,
        # if this call itself fails) is generated live in dig_run instead,
        # so a prefetch failure must never cost the player this artifact.
        try:
            run["pending_layers"] = llm_adapter.generate_ahead(
                path=run["path"], depth=node["depth"] + 1, tunnels=tunnels
            )
        except Exception:
            logger.exception("generate_ahead prefetch failed; falling back to live dig")
            run["pending_layers"] = {}
        return {"correct": True, "artifact": artifact, "tunnels": tunnels}

    attempt = node["cave_ins"]  # 0-based, before incrementing
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
    storage.record_answer(
        run_id, node["id"], node["topic"], node["depth"], body.option_index, False
    )
    storage.record_cave_in(run_id, node["id"], node["topic"], node["depth"], node["cave_ins"])
    return {"correct": False, "cave_in": llm_adapter.cave_in_view(result)}


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
    run["pending_layers"] = {}
    run["path"].append(chosen_node["topic"])

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
