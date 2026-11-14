"""The LLM part of Rabbit Hole: prompts, model calls, parsing, and checking.

Everything the player reads comes from the functions in this file:
  generate_layer()  -> a new layer (explanation, question, artifact, tunnels)
  cave_in()         -> a re-explanation and new question after a wrong answer
  generate_ahead()  -> next layers for all three tunnels, in parallel

Set FAKE_LLM=1 to get canned layers without calling the model (handy for the
frontend person, and for testing the routes before the endpoint is ready).
"""

import json
import os
import random
import re
from concurrent.futures import ThreadPoolExecutor

MODEL = os.environ.get("MODEL_ENDPOINT", "MODEL_NAME_HERE")  # set once the reps confirm the model
FAKE = os.environ.get("FAKE_LLM") == "1"
MAX_TRIES = 3  # how many times to regenerate before giving up

STYLES = ["analogy", "concrete example", "step by step"]

# Agree this list with the frontend person: each keyword maps to one icon drawing.
ICONS = ["fossil", "scroll", "gear", "telescope", "flask", "book",
         "map", "gem", "camera", "atom", "leaf", "coin"]

SYSTEM = (
    "You write content for Rabbit Hole, a learning game where players dig into a "
    "topic one layer at a time and must answer a question to go deeper. "
    "The level rises as the player digs: it starts at middle school and ends at "
    "college. Follow the level asked for at each depth. At every level, teach one "
    "idea at a time and explain any term the player has not met yet. "
    "Reply with a single JSON object and nothing else."
)


# ---------------------------------------------------------------- model calls

_client = None


def _get_client():
    """Create the Databricks client once. Inside Databricks Apps, login is automatic."""
    global _client
    if _client is None:
        from databricks.sdk import WorkspaceClient
        _client = WorkspaceClient().serving_endpoints.get_open_ai_client()
    return _client


def ask_model(prompt, temperature=0.7):
    """Send one prompt to the model and return its reply as plain text."""
    response = _get_client().chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
    )
    return text_from_content(response.choices[0].message.content)


def text_from_content(content):
    """Most models reply with one string. Reasoning models can reply with a list
    of parts (a thinking part, then the answer part). Keep only the answer text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for part in content:
            if isinstance(part, dict):
                kind, text = part.get("type"), part.get("text")
            else:  # the SDK sometimes gives objects instead of dicts
                kind, text = getattr(part, "type", None), getattr(part, "text", None)
            if kind == "text" and text:
                texts.append(text)
        if texts:
            return "".join(texts)
    raise ValueError(f"Unexpected reply format: {content!r}")


# ------------------------------------------------------- parsing and checking

def extract_json(text):
    """Pull the JSON object out of the reply, even if the model added extra text."""
    text = re.sub(r"```(?:json)?", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in reply")
    return json.loads(text[start:end + 1])


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _validate_question(q):
    _require(isinstance(q, dict), "question must be an object")
    _require(isinstance(q.get("text"), str) and q["text"].strip(), "question.text missing")
    options = q.get("options")
    _require(isinstance(options, list) and len(options) == 4
             and all(isinstance(o, str) and o.strip() for o in options),
             "question.options must be 4 strings")
    _require(len(set(o.strip().lower() for o in options)) == 4, "options must be different")
    i = q.get("answer_index")
    _require(isinstance(i, int) and 0 <= i < 4, "answer_index must be 0-3")


def _validate_explanation(text):
    _require(isinstance(text, str) and text.strip(), "explanation missing")
    _require(len(text.split()) <= 140, "explanation too long")  # asked for 100, allow some slack


def validate_layer(layer):
    """Raise ValueError if anything the frontend needs is missing or malformed."""
    _require(isinstance(layer, dict), "layer must be an object")
    _validate_explanation(layer.get("explanation"))
    _validate_question(layer.get("question"))

    artifact = layer.get("artifact")
    _require(isinstance(artifact, dict) and isinstance(artifact.get("name"), str),
             "artifact.name missing")
    if artifact.get("icon") not in ICONS:
        artifact["icon"] = "gem"  # unknown icon: fall back instead of failing

    tunnels = layer.get("tunnels")
    _require(isinstance(tunnels, list) and len(tunnels) == 3
             and all(isinstance(t, str) and t.strip() for t in tunnels),
             "tunnels must be 3 strings")
    _require(len(set(t.strip().lower() for t in tunnels)) == 3, "tunnels must be different")


def shuffle_options(q):
    """Models like to put the right answer first. Shuffle so it lands anywhere."""
    correct = q["options"][q["answer_index"]]
    random.shuffle(q["options"])
    q["answer_index"] = q["options"].index(correct)
    return q


def passes_checker(explanation, q):
    """Second model call: is there exactly one right answer, and can you get it
    from the explanation alone? Returns True if the question is fair."""
    options = "\n".join(f"{i}. {o}" for i, o in enumerate(q["options"]))
    prompt = f"""Check this quiz question against the lesson it is based on.

Lesson:
{explanation}

Question: {q["text"]}
Options:
{options}

Reply with JSON only:
{{"answerable_from_lesson": true or false,
  "number_of_correct_options": a number,
  "correct_index": the number of the correct option,
  "reason": "one short sentence"}}"""
    try:
        verdict = extract_json(ask_model(prompt, temperature=0))
    except (ValueError, json.JSONDecodeError):
        return False
    return (verdict.get("answerable_from_lesson") is True
            and verdict.get("number_of_correct_options") == 1
            and verdict.get("correct_index") == q["answer_index"])


# ----------------------------------------------------------------- the layer

# Shared by LAYER_PROMPT and CAVE_IN_PROMPT. No curly braces in here: it is
# pasted into strings that go through str.format().
QUESTION_RULES = """Question rules:
- Never ask the player to just find a phrase from the explanation.
- Exactly one option is correct, and someone who understood the explanation can
  tell which one. The other three must be clearly wrong to them, and only to them.
- Every wrong option must be tempting to someone who only skimmed. Build each one
  from one of these:
  * a common misconception a beginner would actually hold about this idea
  * a statement that is true on its own but does not answer this question
  * a near miss that gets one key detail wrong (cause swapped with effect, wrong
    direction, wrong amount, a related term mixed up)
- All four options match in length, grammar, and level of detail, and are the same
  kind of thing (all causes, all numbers, all places, ...).
- The correct option must not stand out: do not copy the explanation's exact
  wording into it, and do not make it the longest or most hedged one.
- No joke or absurd options, nothing off topic, no "all of the above" or
  "none of the above", and no giveaway words like "always" or "never" that only
  appear in wrong options."""

# How hard a layer is, by depth. Each tier asks for a different kind of
# question, so going deeper changes what the player has to do, not just the
# subject. No curly braces in here (pasted into str.format() templates).
DIFFICULTY_TIERS = [
    # (deepest depth this tier covers, description)
    (2, """Difficulty: SURFACE (depth 1-2). Level: MIDDLE SCHOOL (ages 11-14).
- Language: short sentences and everyday words. Assume no background beyond
  what a middle schooler knows; explain every technical term.
- Explanation: introduce the idea in everyday words with one simple example.
- Question type: check the player understood the core idea. Describe a simple,
  new example (not the one in the explanation) and ask what it shows, or ask
  which statement correctly describes the idea.
- Wrong options: common beginner misconceptions. A careful reader rules them
  out quickly."""),
    (4, """Difficulty: SHALLOW (depth 3-4). Level: HIGH SCHOOL.
- Language: what a good high school class would use. Basic subject terms are
  fine once introduced; simple numbers or cause-and-effect chains are expected.
- Explanation: go past the basics; name the mechanism or the rule behind the
  idea, not just what happens.
- Question type: apply the idea. Give a short scenario the explanation did not
  mention and ask the player to predict what happens or choose what to do.
- Wrong options: near misses that would be right if one detail of the rule
  were different."""),
    (6, """Difficulty: DEEP (depth 5-6). Level: INTRO COLLEGE (first-year course).
- Language: proper subject vocabulary, used precisely. Assume the player
  remembers the earlier layers on their path; define new terms briefly.
- Explanation: cover the reason why, including a limit, exception, or
  condition where the idea stops working.
- Question type: reason about cause, condition, or exception. Ask why something
  happens, what would change if one factor changed, or which situation the idea
  does NOT apply to.
- Wrong options: all sound expert. Each is a real, related effect or a correct
  statement about a neighboring idea, so only someone who grasped the exact
  reason can pick the right one."""),
    (None, """Difficulty: CORE (depth 7 and below). Level: COLLEGE (upper-level course).
- Language: the precise terms and distinctions a college course in this
  subject would use. Still define anything not covered earlier on the path.
- Explanation: treat the player as a strong learner; give the precise version
  of the idea, including how it connects to an earlier topic on their path.
  Include every fact the question needs, so it is still answerable from this
  explanation alone.
- Question type: multi-step reasoning. The player must combine two facts from
  the explanation, or follow a chain of cause and effect two steps, to reach the
  answer. A single fact alone must not be enough.
- Wrong options: each is the answer you reach if you skip one step, apply the
  idea one step too far, or use only one of the two facts."""),
]


def difficulty_for(depth):
    for deepest, text in DIFFICULTY_TIERS:
        if deepest is None or depth <= deepest:
            return text


LAYER_PROMPT = """The player is digging into: {root}
Path so far: {path}
Next layer topic: {topic}
Depth: {depth} (1 is the surface; deeper layers must be harder)
Already covered, do not repeat: {covered}

{difficulty}

Write this layer as JSON with exactly these fields:
{{
  "explanation": "at most 100 words that teach ONE idea about the topic",
  "question": {{
    "text": "one question that checks the idea",
    "options": ["four", "answer", "choices", "here"],
    "answer_index": the position (0-3) of the one correct option
  }},
  "artifact": {{
    "name": "a real object, discovery, person, or moment tied to this topic",
    "icon": one of {icons}
  }},
  "tunnels": ["three", "different", "subtopics"]
}}

Rules:
- The question must be answerable from the explanation alone.
- Tunnels go deeper from this layer, differ from each other, and avoid covered topics.

""" + QUESTION_RULES


def generate_layer(topic, path, depth):
    """Make one layer. `path` is the list of topics dug so far, oldest first."""
    if FAKE:
        return _fake_layer(topic, depth)

    root = path[0] if path else topic
    prompt = LAYER_PROMPT.format(
        root=root,
        path=" -> ".join(path) if path else "(this is the first layer)",
        topic=topic,
        depth=depth,
        covered=", ".join(path) if path else "nothing yet",
        difficulty=difficulty_for(depth),
        icons=json.dumps(ICONS),
    )

    last_error = None
    for _ in range(MAX_TRIES):
        try:
            layer = extract_json(ask_model(prompt))
            validate_layer(layer)
            if not passes_checker(layer["explanation"], layer["question"]):
                raise ValueError("checker rejected the question")
            layer["depth"] = depth  # set by our code, not trusted from the model
            layer["topic"] = topic  # always the player's chosen topic, set by our code
            shuffle_options(layer["question"])
            return layer
        except (ValueError, json.JSONDecodeError) as e:
            last_error = e
    raise RuntimeError(f"Could not generate layer for {topic!r}: {last_error}")


# ------------------------------------------------------------------ cave-ins

CAVE_IN_PROMPT = """The player got this question wrong and needs the idea explained again.

Topic: {topic}
Original explanation:
{explanation}

Question they missed: {question}
They chose: {chosen}
Correct answer: {correct}

Explain the SAME idea again using a different style: {style}.
The style is only a way in. If you use an analogy or example, the explanation
must also state the real idea plainly, in the topic's own terms.

Then ask a NEW question on the same idea (not the same question reworded).
The new question must be answerable from your new explanation alone.
The question tests the concept, not your analogy or example:
- The question and all four options are about {topic} itself, in its real
  terms. Do not mention the analogy's or example's characters, objects, or
  details, and do not ask what part of it stands for what.
- Someone who understood the idea but skipped your analogy or example must
  still be able to answer it.
Keep the question at this layer's difficulty (the explanation can be clearer,
but the question must not get easier):

{difficulty}

Reply with JSON only:
{{
  "explanation": "at most 100 words",
  "question": {{
    "text": "...",
    "options": ["four", "answer", "choices", "here"],
    "answer_index": the position (0-3) of the one correct option
  }}
}}

""" + QUESTION_RULES


def cave_in(layer, chosen_index, attempt):
    """Re-explain after a wrong answer. `attempt` counts cave-ins on this layer
    (0 for the first), so each one uses a different style."""
    style = STYLES[attempt % len(STYLES)]
    if FAKE:
        return _fake_cave_in(layer, style)

    q = layer["question"]
    prompt = CAVE_IN_PROMPT.format(
        topic=layer["topic"],
        explanation=layer["explanation"],
        question=q["text"],
        chosen=q["options"][chosen_index] if 0 <= chosen_index < 4 else "(no answer)",
        correct=q["options"][q["answer_index"]],
        style=style,
        difficulty=difficulty_for(layer.get("depth", 1)),
    )

    last_error = None
    for _ in range(MAX_TRIES):
        try:
            result = extract_json(ask_model(prompt))
            _validate_explanation(result.get("explanation"))
            _validate_question(result.get("question"))
            if not passes_checker(result["explanation"], result["question"]):
                raise ValueError("checker rejected the question")
            shuffle_options(result["question"])
            return {"explanation": result["explanation"], "style": style,
                    "question": result["question"]}
        except (ValueError, json.JSONDecodeError) as e:
            last_error = e
    raise RuntimeError(f"Could not generate cave-in for {layer['topic']!r}: {last_error}")


# ------------------------------------------------------------ generate ahead

def generate_ahead(path, depth, tunnels):
    """Make the next layer for all three tunnels at the same time.
    Returns {tunnel: layer}; a tunnel that failed is left out."""
    def one(tunnel):
        try:
            return tunnel, generate_layer(tunnel, path, depth)
        except RuntimeError:
            return tunnel, None

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = pool.map(one, tunnels)
    return {tunnel: layer for tunnel, layer in results if layer is not None}


# ------------------------------------------------------- fake mode (testing)

def _fake_layer(topic, depth):
    return {
        "depth": depth,
        "topic": topic,
        "explanation": f"This is placeholder text about {topic}. "
                       "The real version comes from the model.",
        "question": {
            "text": f"Which option is correct for {topic}?",
            "options": ["Wrong A", "Right answer", "Wrong B", "Wrong C"],
            "answer_index": 1,
        },
        "artifact": {"name": f"A relic of {topic}", "icon": "gem"},
        "tunnels": [f"{topic} part {depth}a", f"{topic} part {depth}b", f"{topic} part {depth}c"],
    }


def _fake_cave_in(layer, style):
    return {
        "explanation": f"Placeholder {style} re-explanation of {layer['topic']}.",
        "style": style,
        "question": {
            "text": f"New question on {layer['topic']}?",
            "options": ["Right answer", "Wrong A", "Wrong B", "Wrong C"],
            "answer_index": 0,
        },
    }
