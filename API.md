# Rabbit Hole API

Reference for `backend/api/main.py`, as built. Base URL: `http://localhost:8000`.
CORS is wide open (`allow_origins=["*"]`).

State is an in-memory dict (`RUNS`), keyed by `run_id`, lost on restart.
Every write also goes to Databricks (`storage.py`) for analytics only;
those writes never affect gameplay or these responses, and failures there
are swallowed and logged, not surfaced here.

`llm_adapter.py` wraps `backend/LLM/llm.py` unchanged and renames fields:

| their shape | this API's shape |
|---|---|
| `explanation` | `layer` |
| `question.text` | `question` |
| `question.options` | `options` |
| `question.answer_index` | kept server-side as `correct_index`; **never sent to the frontend** |
| `artifact` (`name`, `icon`) | same two fields, plus `depth` added by the API |
| `cave_in()` result | nested under `cave_in`, with a `style` field |

If any LLM call raises `RuntimeError` (model/parse failure after retries),
the endpoint returns **503** with `{"error": "<message>"}` instead of its
normal body — this is the one case where the response shape isn't the one
documented below for that route.

`FAKE_LLM=1` in `.env` makes `llm.py` return fixed canned content instead of
calling the model (no network calls, deterministic `answer_index`). Useful
for testing routes without burning model calls.

---

## `POST /runs`

Start a run on a topic.

**Request**
```json
{"topic": "black holes"}
```

**Response `200`**
```json
{
  "run_id": "88bf7e69-f0c2-4197-a7a7-8be91b659a16",
  "depth": 1,
  "topic": "black holes",
  "turn": {
    "layer": "This is placeholder text about black holes. The real version comes from the model.",
    "question": "Which option is correct for black holes?",
    "options": ["Wrong A", "Right answer", "Wrong B", "Wrong C"]
  }
}
```

**Response `503`** (generation failed)
```json
{"error": "Could not generate layer for 'black holes': checker rejected the question"}
```

Note: `topic` here (and everywhere else, including `GET`) is the layer's
own generated topic string, which can reword what was submitted — the run
is stored under that restated topic from creation on, not the raw input.

---

## `POST /runs/{run_id}/answer`

Answer the current turn's question.

**Request**
```json
{"option_index": 1}
```

**Response `200`, correct** — clears the layer, collects its artifact, and
returns the 3 next-topic tunnels (already being pre-generated in the
background for an instant `dig`):
```json
{
  "correct": true,
  "artifact": {"name": "A relic of black holes", "icon": "gem", "depth": 1},
  "tunnels": ["black holes part 1a", "black holes part 1b", "black holes part 1c"]
}
```

**Response `200`, wrong** — the new question replaces the run's current
question; `correct_index` is tracked server-side only:
```json
{
  "correct": false,
  "cave_in": {
    "layer": "Placeholder analogy re-explanation of black holes.",
    "question": "New question on black holes?",
    "options": ["Right answer", "Wrong A", "Wrong B", "Wrong C"],
    "style": "analogy"
  }
}
```

**Response `404`** — unknown `run_id`:
```json
{"detail": "run not found"}
```

**Response `400`** — `option_index` not in `0..len(options)-1`:
```json
{"detail": "option_index out of range"}
```

**Response `503`** — `cave_in()` raised `RuntimeError`:
```json
{"error": "Could not generate cave-in for 'black holes': checker rejected the question"}
```

---

## `POST /runs/{run_id}/dig`

Dig into one of the three tunnels returned by the last correct answer.
Only valid right after a correct `answer` (the server rejects it otherwise).

**Request**
```json
{"tunnel_index": 1}
```

**Response `200`** — becomes the new current node/turn; the two unchosen
tunnels are recorded in the run's map as `"skipped"` (see `GET`):
```json
{
  "depth": 2,
  "topic": "black holes part 1b",
  "turn": {
    "layer": "This is placeholder text about black holes part 1b. The real version comes from the model.",
    "question": "Which option is correct for black holes part 1b?",
    "options": ["Wrong A", "Right answer", "Wrong B", "Wrong C"]
  }
}
```

**Response `404`** — unknown `run_id`:
```json
{"detail": "run not found"}
```

**Response `400`** — no correct answer yet to dig from:
```json
{"detail": "answer correctly before digging"}
```

**Response `400`** — `tunnel_index` not `0`, `1`, or `2`:
```json
{"detail": "tunnel_index out of range"}
```

**Response `503`** — the chosen tunnel wasn't pre-generated and the live
fallback `generate_layer()` call raised `RuntimeError`:
```json
{"error": "Could not generate layer for 'black holes part 1b': checker rejected the question"}
```

---

## `GET /runs/{run_id}`

End-screen / run summary. Also stamps `ended_at`, `max_depth`, and
`first_try_count` onto the run's Databricks row (analytics only — callable
more than once, each call just re-stamps it).

**Response `200`**
```json
{
  "topic": "black holes",
  "depth": 2,
  "layers_cleared": 1,
  "first_try_count": 0,
  "artifacts": [
    {"name": "A relic of black holes", "icon": "gem", "depth": 1}
  ],
  "map": [
    {"id": "n1", "parent_id": null, "topic": "black holes", "depth": 1, "status": "dug", "cave_ins": 1},
    {"id": "n2", "parent_id": "n1", "topic": "black holes part 1a", "depth": 2, "status": "skipped", "cave_ins": 0},
    {"id": "n3", "parent_id": "n1", "topic": "black holes part 1b", "depth": 2, "status": "dug", "cave_ins": 0},
    {"id": "n4", "parent_id": "n1", "topic": "black holes part 1c", "depth": 2, "status": "skipped", "cave_ins": 0}
  ]
}
```

- `layers_cleared` = number of artifacts collected.
- `first_try_count` = number of cleared nodes that had 0 cave-ins.
- `map` node `status` is always `"dug"` or `"skipped"` — there's no `"cleared"`/`"current"` status; the root node starts `"dug"`.
- `artifact.icon` is always one of `llm.py`'s fixed `ICONS` list (`fossil`, `scroll`, `gear`, `telescope`, `flask`, `book`, `map`, `gem`, `camera`, `atom`, `leaf`, `coin`); `llm.py` substitutes `"gem"` itself if the model returns anything else.

**Response `404`** — unknown `run_id`:
```json
{"detail": "run not found"}
```
