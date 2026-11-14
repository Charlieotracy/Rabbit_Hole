"""The web routes the frontend calls. Each route reads the run from memory,
asks llm.py for content, saves the result, and returns JSON.

  POST /runs                       {"topic": "black holes"}        -> {"run_id", "layer"}
  POST /runs/{run_id}/dig          {"tunnel": "Hawking radiation"} -> {"layer"}
  POST /runs/{run_id}/answer       {"chosen_index": 2}             -> {"correct", "answer_index"}
  POST /runs/{run_id}/cave-in      {"chosen_index": 2}             -> {"explanation", "style", "question"}

Run locally:  python app.py   (then open http://localhost:8000/docs to try the routes)
"""

import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import llm
import store

app = FastAPI()

# Lets a frontend running on a different address (like localhost:5173) call us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------- what the frontend sends us

class RunRequest(BaseModel):
    topic: str


class DigRequest(BaseModel):
    tunnel: str


class AnswerRequest(BaseModel):
    chosen_index: int


# ------------------------------------------------------------------- helpers

# Layers generated ahead of time, waiting for the player to pick a tunnel.
# Kept in this process on purpose: it's a speed-up, not something to save.
_ahead = {}  # run_id -> {tunnel: layer}


def _load_run(run_id):
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown run_id")
    return run


def _path(run):
    return [layer["topic"] for layer in run["layers"]]


def _start_ahead(run_id):
    """Generate the next layer for all three tunnels in the background."""
    run = store.get_run(run_id)
    current = run["layers"][-1]
    path, depth = _path(run), current["depth"] + 1

    def work():
        _ahead[run_id] = llm.generate_ahead(path, depth, current["tunnels"])

    _ahead.pop(run_id, None)
    threading.Thread(target=work, daemon=True).start()


# -------------------------------------------------------------------- routes

@app.post("/runs")
def create_run(body: RunRequest):
    topic = body.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="topic is required")
    run_id = store.create_run(topic)
    try:
        layer = llm.generate_layer(topic, [], 1)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    store.save_layer(run_id, layer)
    _start_ahead(run_id)
    return {"run_id": run_id, "layer": layer}


@app.post("/runs/{run_id}/dig")
def dig(run_id: str, body: DigRequest):
    run = _load_run(run_id)
    current = run["layers"][-1]
    if body.tunnel not in current["tunnels"]:
        raise HTTPException(status_code=400, detail="tunnel is not one of the current choices")

    # Use the layer generated ahead if it's ready; otherwise make it now.
    layer = _ahead.get(run_id, {}).get(body.tunnel)
    if layer is None:
        try:
            layer = llm.generate_layer(body.tunnel, _path(run), current["depth"] + 1)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
    store.save_layer(run_id, layer)
    _start_ahead(run_id)
    return {"layer": layer}


@app.post("/runs/{run_id}/answer")
def answer(run_id: str, body: AnswerRequest):
    """Record an answer to the layer's current question and say if it was right."""
    run = _load_run(run_id)
    current = run["layers"][-1]
    correct_index = current.get("active_question", current["question"])["answer_index"]
    correct = body.chosen_index == correct_index
    store.save_answer(run_id, current["depth"], correct)
    return {"correct": correct, "answer_index": correct_index}


@app.post("/runs/{run_id}/cave-in")
def cave_in(run_id: str, body: AnswerRequest):
    run = _load_run(run_id)
    current = run["layers"][-1]
    attempt = sum(1 for c in run["cave_ins"] if c["depth"] == current["depth"])

    # The question the player just missed (the original, or the last re-ask).
    missed = dict(current, question=current.get("active_question", current["question"]))
    try:
        result = llm.cave_in(missed, body.chosen_index, attempt)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    current["active_question"] = result["question"]  # /answer checks against this now
    store.save_cave_in(run_id, current["depth"], result["style"])
    return result


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DATABRICKS_APP_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
