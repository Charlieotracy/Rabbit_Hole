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

If any LLM call fails (model/parse failure after retries, or a rate limit),
the endpoint returns **503** with `{"error": "<message>"}` instead of its
normal body — this is the one case where the response shape isn't the one
documented below for that route. The message is always a short, in-theme
string for the player, never the raw exception: a rate limit becomes
`"The tunnel's busy — give it a moment and try again."`, anything else
becomes `"That tunnel collapsed. Try again?"`. The real exception is
logged server-side only.

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
{"error": "That tunnel collapsed. Try again?"}
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

**Response `503`** — `cave_in()` failed (including a rate limit after retries):
```json
{"error": "That tunnel collapsed. Try again?"}
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
fallback `generate_layer()` call failed:
```json
{"error": "That tunnel collapsed. Try again?"}
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

---

# Proposal: streaming turn delivery

**Status: spec only, nothing below this line is implemented.** For the
team to agree on shapes — and on the new backend capability this
actually requires — before anyone builds it.

**This version replaces an earlier draft that chunked an
already-complete response.** That doesn't cut the wait: the player
still sits through the full generation time before the first chunk,
just receives it in pieces afterward. The only version that actually
helps is real token streaming — `ask_model` requesting `stream=True`
from the model and `generate_layer`/`cave_in` handing explanation text
to the player while the model is still writing it. That's what's
specified here, including the hard part it creates: **once a token of
the explanation has reached the player, it's permanent.** It cannot be
withdrawn or replaced if something downstream later fails. Everything
below is about designing around that one fact.

## New backend capability this needs (not just an API shape)

Today `generate_layer`/`cave_in` are one unit: generate the whole
JSON blob (explanation + question + artifact + tunnels together), then
validate all of it, and on *any* failure throw the whole attempt away
and generate a fresh one from scratch. That's fine when nothing has
been shown yet. It stops being fine the moment the explanation is on
the player's screen — a retry can no longer touch it.

So generation needs to become two phases, with a hard commit point
between them:

1. **Phase 1 — explanation.** `ask_model_stream(prompt)` (new: calls
   the model with `stream=True` and yields text deltas as they arrive,
   instead of returning one string). `generate_layer` reads the
   `"explanation"` field's value out of the streaming JSON as it comes
   in — straightforward because the prompt already puts `explanation`
   first in the object, so this is "scan for `"explanation": "`, then
   emit characters until the matching closing quote," not a general
   streaming-JSON parser. Each piece is hashed through to the API
   layer as a `text` event, live.

   The explanation is **committed the moment its first token is sent**
   — not after `_validate_explanation` passes. There's no safe gap to
   validate-then-send; by the time we know the full explanation, some
   of it may already be on screen. In practice this check almost never
   fails (the model is asked for ≤100 words, the limit is 140, and
   nothing in `check_question`'s rejection reasons is ever about the
   explanation itself — every `Rejected` today is about the question).
   The remaining risk (explanation runs long, or the model's own stream
   drops mid-sentence) is accepted and logged, not enforced — there is
   nothing left to enforce it *against* once it's shown.

2. **Phase 2 — everything else.** A **new function**, something like
   `regenerate_rest(topic, explanation, depth, path, feedback=None)`,
   that takes the now-fixed explanation and produces only
   `{question, artifact, tunnels}` for it — running the exact same
   `check_question` gate (lesson check, blind check from depth 3) as
   today. On a `Rejected`, it retries *this phase only*, with the
   explanation untouched, up to its own attempt budget (reuse
   `MAX_TRIES`, or tune separately — team's call). This is new backend
   work, not a reshuffling of what `generate_layer` already does: there
   is no function today that takes an explanation as a given and
   generates a question to match it. `cave_in`'s re-explain-then-ask
   shape is the closest existing thing but always rewrites the
   explanation in a new style, which is the one thing this phase must
   not do.

   If every attempt in this phase is exhausted, that's a genuine
   terminal failure — but one where the player has already read an
   explanation with no question to show for it. There's no clean
   recovery: the player's options are to retry (which abandons that
   explanation and starts over) or move on. This is a known, accepted
   gap in this design, not solved here — flagged below as a decision
   for the team, not papered over.

`cave_in` needs the identical split (its own `ask_model_stream` use for
the re-explanation text, then a phase-2 retry loop for the question)
for exactly the same reason: a cave-in's re-explanation is just as
unrecoverable once shown as a fresh layer's is.

**Reasoning-token risk — checked empirically, resolved.** Made one live
streaming call to `databricks-gpt-oss-120b` (`stream=True`, `max_tokens=40`)
and inspected the raw chunks. It does stream reasoning ahead of the
answer — 8 straight chunks of chain-of-thought before anything else in
that call. But each chunk tags which kind it is: a reasoning chunk has
`delta.content=None` and `delta.reasoning_content="<thinking text>"`; an
answer chunk is the reverse. `ask_model_stream` only needs to forward
`delta.content` and silently drop any chunk where it's `None` — a
per-chunk check, not something requiring the full response. Confirmed
safe to build.

One thing this same test surfaced that the proposal didn't account for:
in that call, all 40 tokens went to reasoning and the model never
reached the answer at all (`finish_reason: "length"`). This model can
spend a real amount of budget and wall-clock time thinking before the
explanation starts.

**Measured: time-to-first-answer-token decides whether this is worth
building, and it hinges on `reasoning_effort`.** One real
`generate_layer`-shaped prompt (black holes, depth 1), streamed, timed
to the first `delta.content` chunk:

| | first reasoning chunk | first answer chunk | total |
|---|---|---|---|
| default reasoning_effort | 0.78s | **3.70s** | 4.22s |
| `reasoning_effort="low"` | 0.53s | **0.55s** | 1.46s |

At default effort, streaming still helps (3.70s to first token vs. the
~7-7.6s the full non-streaming generate+validate cycle takes today) but
it's a modest win. At `reasoning_effort="low"`, the answer starts
essentially immediately — this is the difference between "streaming
is nice" and "streaming is the point." **Recommendation: pair this
proposal with `reasoning_effort="low"` on the generation call, not
just the checker calls it's already on.**

**That recommendation carries a real risk, flagged before testing it:**
Ruby applied `reasoning_effort="low"` only to checker calls tonight,
alongside a string of commits specifically tightening question quality
(stricter checker, cave-ins testing the concept not the analogy,
depth-scaled difficulty). Generation is a different call in the same
pipeline, and dropping its reasoning effort could undo exactly the
content-quality work that series of commits was aimed at. This is not
a detail to wave through — it needs real output to check, not an
assumption.

**Checked: 3 paired layers (same topic+depth, default vs. low effort
on generation, checker untouched).** One clean comparison came back —
black holes, depth 1, both succeeded, both read as solid, comparable
in length and quality; no degradation visible between them. The other
two pairs (jazz depth 3, DNA depth 6) **failed identically at both
settings** — each exhausted all 3 retries on the same checker
rejection ("wording gives the answer away"), regardless of reasoning
effort. That's a real, pre-existing reliability gap at harder depths,
independent of this change, surfaced as a side effect of this test
rather than something this proposal caused or fixes.

**Net: thin evidence, not a green light.** One successful side-by-side
pair showing no quality loss is not enough to sign off on dropping
reasoning effort for every generation call. Before adopting the
recommendation above, get a larger paired sample — especially at the
depths that already fail some fraction of the time at default effort —
to see whether low effort makes that failure rate worse, the same, or
(conceivably) better.

## Compatibility

Every existing endpoint above keeps its exact current request and
response shape, unconditionally. Streaming is opt-in per request via a
new `"stream": true` field; omitting it (or sending `false`) is 100%
today's behavior. Old frontend code needs zero changes.

## Changed requests

`POST /runs`, `POST /runs/{run_id}/answer`, and `POST /runs/{run_id}/dig`
each accept one new optional field:

```json
{"topic": "black holes", "stream": true}
{"option_index": 1, "stream": true}
{"tunnel_index": 1, "stream": true}
```

With `"stream": true`:

- **`POST /runs`** responds immediately with `{run_id, depth, topic}` —
  no `turn`. Generation starts in the background; the frontend opens
  `GET /runs/{run_id}/layer` to receive it.
- **`POST /runs/{run_id}/answer`**, correct answer: **unchanged** —
  still returns `{correct: true, artifact, tunnels}` synchronously. This
  payload is already small and instant; there's nothing worth streaming.
- **`POST /runs/{run_id}/answer`**, wrong answer: responds immediately
  with `{"correct": false}` — no `cave_in`. The frontend opens
  `GET /runs/{run_id}/cave-in`.
- **`POST /runs/{run_id}/dig`** responds immediately with `{depth, topic}`
  — no `turn`; the frontend opens `GET /runs/{run_id}/layer`. If the
  tunnel was already pre-generated (the common case today), this
  proposal doesn't change that path — pre-generated layers still have
  no token-by-token moment to stream, so `/layer` just emits the whole
  explanation as one `text` event followed immediately by `question`
  and `done`.

All error responses (`404`, `400`) are unchanged either way.

## `GET /runs/{run_id}/layer` and `GET /runs/{run_id}/cave-in`

Server-sent events (`Content-Type: text/event-stream`), each event as:

```
event: <type>
data: <json>

```

Event types, in this order:

1. **`text`** — zero or more, in order, live as the model writes them.
   `{"delta": "<chunk>"}`. Concatenating every `delta` in arrival order
   reconstructs the explanation (today's `turn.layer` / `cave_in.layer`).
   Chunk granularity (per-token vs. batched) is an implementation
   choice, not part of this contract.
2. **`explanation_committed`** — exactly one, marks the explanation as
   final. `{"text": "<full explanation>"}` (the complete text, as a
   redundant check against any dropped `text` events). Everything
   before this point can still fail cleanly with no visible residue;
   nothing from here on can.
3. **`retrying`** — zero or more, each time phase 2 (the question) is
   rejected and another attempt is starting. `{"reason": "<why the
   previous attempt was rejected>", "attempt": 2, "max_attempts": 3}`.
   The frontend shows a "still working on your question…" state;
   critically, it must **not** touch the explanation already on screen.
4. **`question`** — exactly one, the phase-2 result once it passes
   validation. `{"question": "...", "options": ["...", "...", "...", "..."]}`
   on `/layer`; `/cave-in` adds `"style"`, matching today's `cave_in.style`.
5. **`done`** — exactly one, terminal, success only. `{}`.
6. **`error`** — terminal, sent *instead of* `done`.
   `{"error": "<message>", "explanation_shown": true | false}`, using
   the same friendly messages as the non-streaming 503s. No `question`
   or `done` follows an `error`.
   - `explanation_shown: false` — nothing reached the player (failed
     before or during the first `text` event, e.g. a rate limit before
     the model ever responded). Equivalent to today's clean 503: show
     the error, retry replaces nothing.
   - `explanation_shown: true` — phase 2 exhausted every retry (or the
     model's stream itself dropped mid-explanation). The explanation is
     still sitting on the player's screen with no question. **How the
     frontend should present this is an open product question** — options
     include keeping the explanation visible with an inline "couldn't
     come up with a fair question for this — try again?", or treating it
     like today's full-screen error and accepting that the explanation
     gets abandoned on retry. Not decided here.

**How the frontend knows a stream is finished:** receiving `done` or
`error` — exactly one of the two, exactly once, both terminal. Don't
rely on the HTTP connection closing as the signal; treat the event
itself as authoritative.

## Open questions for the team

- How should the frontend present the `explanation_shown: true` error
  case (see above) — this is a real product decision, not a detail.
- **Whether `reasoning_effort="low"` on generation is safe to adopt** —
  one clean pair showed no quality loss, but that's not enough evidence
  on its own (see the measurement above). Needs a larger paired sample,
  specifically at depths that already see some checker-rejection
  failures at default effort, before this is a real recommendation
  rather than a promising lead.
- Separate retry budget for phase 2, or reuse `MAX_TRIES`?
- Should there be a combined time/attempt ceiling across phase 1 +
  phase 2 so a player never watches "still working on your question…"
  for an unreasonable stretch, even though each phase individually
  retries a bounded number of times?
- `text` chunk granularity (per-token vs. batched) and whether to send
  periodic SSE comment pings during any silent gap, so proxies don't
  kill an idle connection.
- What `GET /runs/{run_id}/layer` returns if called with no generation
  in flight and nothing pending (e.g. called twice).
