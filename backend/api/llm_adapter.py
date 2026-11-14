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

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from ..LLM import llm  # noqa: E402  (FAKE_LLM must be in os.environ before this import)


def generate_layer(topic: str, path: list, depth: int) -> dict:
    """Returns their raw layer dict (topic, depth, explanation, question, artifact, tunnels)."""
    return llm.generate_layer(topic=topic, path=path, depth=depth)


def cave_in(layer: dict, chosen_index: int, attempt: int) -> dict:
    """Returns their raw result dict (explanation, style, question)."""
    return llm.cave_in(layer=layer, chosen_index=chosen_index, attempt=attempt)


def generate_ahead(path: list, depth: int, tunnels: list) -> dict:
    """Returns {tunnel_name: raw layer dict}; a tunnel that failed is left out."""
    return llm.generate_ahead(path=path, depth=depth, tunnels=tunnels)


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
