import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    topic: str


@app.post("/runs")
def create_run(body: RunRequest):
    run_id = str(uuid.uuid4())
    return {
        "run_id": run_id,
        "depth": 1,
        "topic": body.topic,
        "turn": {
            "layer": f"Placeholder explanation of {body.topic}.",
            "question": "Placeholder question?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
        },
    }
