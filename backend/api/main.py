import random
import uuid
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNS: Dict[str, dict] = {}


class RunRequest(BaseModel):
    topic: str


class AnswerRequest(BaseModel):
    option_index: int


class DigRequest(BaseModel):
    tunnel_index: int


def _new_turn(topic: str) -> dict:
    return {
        "layer": f"Placeholder explanation of {topic}.",
        "question": f"Placeholder question about {topic}?",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correct_index": random.randint(0, 3),
    }


def _public_turn(turn: dict) -> dict:
    return {
        "layer": turn["layer"],
        "question": turn["question"],
        "options": turn["options"],
    }


def _get_run(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


@app.post("/runs")
def create_run(body: RunRequest):
    run_id = str(uuid.uuid4())
    turn = _new_turn(body.topic)
    root_id = "n1"
    RUNS[run_id] = {
        "topic": body.topic,
        "depth": 1,
        "turn": turn,
        "tunnels": None,
        "artifacts": [],
        "nodes": {
            root_id: {
                "id": root_id,
                "parent_id": None,
                "topic": body.topic,
                "depth": 1,
                "status": "dug",
                "cave_ins": 0,
            }
        },
        "node_order": [root_id],
        "current_node_id": root_id,
        "cleared_node_ids": set(),
        "next_node_num": 2,
    }
    return {
        "run_id": run_id,
        "depth": 1,
        "topic": body.topic,
        "turn": _public_turn(turn),
    }


@app.post("/runs/{run_id}/answer")
def answer_run(run_id: str, body: AnswerRequest):
    run = _get_run(run_id)
    turn = run["turn"]
    if not 0 <= body.option_index < len(turn["options"]):
        raise HTTPException(status_code=400, detail="option_index out of range")

    node = run["nodes"][run["current_node_id"]]

    if body.option_index == turn["correct_index"]:
        run["cleared_node_ids"].add(node["id"])
        artifact = {"name": f"{node['topic']} Artifact", "depth": node["depth"]}
        run["artifacts"].append(artifact)
        tunnels = [f"{node['topic']}: tunnel {i + 1}" for i in range(3)]
        run["tunnels"] = tunnels
        return {"correct": True, "artifact": artifact, "tunnels": tunnels}

    node["cave_ins"] += 1
    new_turn = _new_turn(node["topic"])
    run["turn"] = new_turn
    return {"correct": False, "cave_in": _public_turn(new_turn)}


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

    chosen_node = None
    for i, tunnel_topic in enumerate(tunnels):
        node_id = f"n{run['next_node_num']}"
        run["next_node_num"] += 1
        status = "dug" if i == body.tunnel_index else "skipped"
        node = {
            "id": node_id,
            "parent_id": parent_node["id"],
            "topic": tunnel_topic,
            "depth": new_depth,
            "status": status,
            "cave_ins": 0,
        }
        run["nodes"][node_id] = node
        run["node_order"].append(node_id)
        if status == "dug":
            chosen_node = node

    run["current_node_id"] = chosen_node["id"]
    run["depth"] = new_depth
    run["tunnels"] = None

    new_turn = _new_turn(chosen_node["topic"])
    run["turn"] = new_turn
    return {
        "depth": new_depth,
        "topic": chosen_node["topic"],
        "turn": _public_turn(new_turn),
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

    return {
        "topic": run["topic"],
        "depth": run["depth"],
        "layers_cleared": layers_cleared,
        "first_try_count": first_try_count,
        "artifacts": run["artifacts"],
        "map": [nodes[node_id] for node_id in run["node_order"]],
    }
