"""The LLM part of Rabbit Hole: prompts, model calls, parsing, and checking.

Everything the player reads comes from the functions in this file:
  generate_layer()  -> a new layer (explanation, question, artifact, tunnels)
  cave_in()         -> a re-explanation and new question after a wrong answer
  generate_ahead()  -> next layers for all three tunnels, in parallel

Set FAKE_LLM=1 to get canned layers without calling the model (handy for the
frontend person, and for testing the routes before the endpoint is ready).
"""

import json
import logging
import os
import random
import re
from concurrent.futures import ThreadPoolExecutor

MODEL = os.environ.get("MODEL_ENDPOINT", "MODEL_NAME_HERE")  # set once the reps confirm the model
FAKE = os.environ.get("FAKE_LLM") == "1"
MAX_TRIES = 3  # how many times to regenerate before giving up

logger = logging.getLogger("rabbit_hole.llm")

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


# How hard the model thinks before checker replies ("low", "medium", "high").
# Checking is mostly careful reading, so "low" saves time. Set
# CHECKER_REASONING_EFFORT to another level, or to an empty value to send none
# and use the endpoint's default. Generation always uses the default.
CHECKER_REASONING_EFFORT = os.environ.get("CHECKER_REASONING_EFFORT", "low").strip() or None

# The checker runs on a different model from the generator, so it doesn't
# share the generator's blind spots when judging its questions. Set
# CHECKER_MODEL_ENDPOINT to a serving endpoint in the same workspace; if it is
# unset, the checker uses MODEL.
CHECKER_MODEL = os.environ.get("CHECKER_MODEL_ENDPOINT", "").strip() or MODEL

# Endpoints that refused reasoning_effort, so it is not sent to them again.
_no_reasoning_effort = set()


def ask_model(prompt, temperature=0.7, reasoning_effort=None, model=None):
    """Send one prompt to a model and return its reply as plain text.
    `model` is the serving endpoint (default MODEL). `reasoning_effort` asks a
    reasoning model to think less or more; None leaves the endpoint default."""
    model = model or MODEL
    kwargs = dict(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
    )
    if reasoning_effort and model not in _no_reasoning_effort:
        try:
            response = _get_client().chat.completions.create(
                reasoning_effort=reasoning_effort, **kwargs)
            return text_from_content(response.choices[0].message.content)
        except Exception as e:
            from openai import BadRequestError
            if not isinstance(e, BadRequestError):
                raise
            _no_reasoning_effort.add(model)
            logger.warning("endpoint %s refused reasoning_effort=%r (%s); "
                           "sending its calls without it from now on", model, reasoning_effort, e)
    response = _get_client().chat.completions.create(**kwargs)
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


# ------------------------------------------------------------------ checker
#
# Every generated question goes through check_question() before the player
# sees it. A rejection carries a reason, which is logged and fed back into the
# next generation attempt so the retry can fix the actual problem.

class Rejected(ValueError):
    """The checker turned the question down; `reason` says why."""

    def __init__(self, reason):
        super().__init__(f"checker rejected the question: {reason}")
        self.reason = reason


class CheckerError(Exception):
    """The checker's own reply was unusable. Not the question's fault, so
    nothing is fed back, but the question is still not trusted."""


# The blind check only runs from this depth down. At the surface, a big-picture
# question a student could already answer is fine.
BLIND_CHECK_FROM_DEPTH = 3

LESSON_CHECK_PROMPT = """Check this quiz question against the lesson it is based on.

Lesson:
{explanation}

Question: {question}
Options:
{options}

Judge every option in order, using only the lesson. Give your reasoning for each
option before its verdict:
- "correct": the lesson shows this answers the question
- "wrong": the lesson shows this does not answer the question
- "arguable": a careful reader could reasonably defend it as correct, or the
  lesson does not settle it

Reply with JSON only:
{{"options": [
    {{"why": "reasoning from the lesson", "verdict": "correct" or "wrong" or "arguable"}},
    ... one entry per option, in order (4 total)
  ],
  "answerable_from_lesson": true or false,
  "problem": "one sentence on the main problem with this question, or empty if none"}}"""

BLIND_CHECK_PROMPT = """A typical {level} student has NOT read the lesson. They see only this
quiz question:

Question: {question}
Options:
{options}

Think about how that student would do. First reason it through, then give the
verdict. Also look for wording that gives the answer away even to someone who
knows nothing: one option longer, more specific, or more carefully hedged than
the rest; the only option that fits the question's grammar; giveaway words; or
three options that are obviously silly.

Reply with JSON only:
{{"reasoning": "how the student would approach it, and any wording clues",
  "likely_pick": the number of the option they would most likely pick,
  "confidence": "high" or "medium" or "low",
  "wording_gives_it_away": true or false}}"""


def _sentence(text):
    """Checker text as a sentence that can be followed by another one."""
    text = str(text or "").strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text


def _join(*parts):
    return " ".join(p for p in parts if p)


def _options_text(q):
    return "\n".join(f"{i}. {o}" for i, o in enumerate(q["options"]))


# Set if CHECKER_MODEL turns out not to exist or not be usable, so the checker
# falls back to MODEL instead of failing every question.
_checker_fallback = False


def _checker_model_reply(prompt):
    global _checker_fallback
    from openai import NotFoundError, PermissionDeniedError

    model = MODEL if _checker_fallback else CHECKER_MODEL
    try:
        return ask_model(prompt, temperature=0, model=model,
                         reasoning_effort=CHECKER_REASONING_EFFORT)
    except (NotFoundError, PermissionDeniedError) as e:
        if model == MODEL:
            raise
        _checker_fallback = True
        logger.warning("checker endpoint %s is not usable (%s); checking with %s instead",
                       CHECKER_MODEL, e, MODEL)
        return ask_model(prompt, temperature=0, model=MODEL,
                         reasoning_effort=CHECKER_REASONING_EFFORT)


def _ask_checker(prompt):
    try:
        reply = extract_json(_checker_model_reply(prompt))
    except (ValueError, json.JSONDecodeError) as e:
        raise CheckerError(f"unreadable checker reply: {e}") from e
    if not isinstance(reply, dict):
        raise CheckerError("checker reply was not an object")
    return reply


def _lesson_check(explanation, q):
    """One right answer, no arguable wrong ones, answerable from the lesson."""
    reply = _ask_checker(LESSON_CHECK_PROMPT.format(
        explanation=explanation, question=q["text"], options=_options_text(q)))
    judged = reply.get("options")
    if not (isinstance(judged, list) and len(judged) == 4
            and all(isinstance(o, dict) for o in judged)):
        raise CheckerError("checker did not judge all 4 options")

    verdicts = [str(o.get("verdict", "")).strip().lower() for o in judged]
    whys = [_sentence(o.get("why")) for o in judged]
    problem = _sentence(reply.get("problem"))
    options = q["options"]

    if reply.get("answerable_from_lesson") is not True:
        raise Rejected(_join("the question cannot be answered from the explanation alone.", problem))
    for i, verdict in enumerate(verdicts):
        if verdict == "arguable":
            raise Rejected(_join(f'the wrong option "{options[i]}" could be argued to be correct:', whys[i]))
    correct = [i for i, v in enumerate(verdicts) if v == "correct"]
    if len(correct) != 1:
        raise Rejected(_join(f"{len(correct)} options are correct; there must be exactly one.", problem))
    if correct[0] != q["answer_index"]:
        i = correct[0]
        raise Rejected(_join(f'the option marked correct is "{options[q["answer_index"]]}", '
                             f'but the explanation supports "{options[i]}":', whys[i]))


def _blind_check(q, depth):
    """Without the lesson, would the player get it anyway?"""
    level = level_for(depth)
    reply = _ask_checker(BLIND_CHECK_PROMPT.format(
        level=level, question=q["text"], options=_options_text(q)))
    reasoning = _sentence(reply.get("reasoning"))

    if reply.get("wording_gives_it_away") is True:
        raise Rejected(_join("the wording gives the answer away without reading the explanation:",
                             reasoning,
                             "Make all four options match in length, detail, and grammar."))
    if (reply.get("likely_pick") == q["answer_index"]
            and str(reply.get("confidence", "")).strip().lower() == "high"):
        raise Rejected(_join(f"too easy: a {level} student who has not read the explanation "
                             "would confidently pick the right answer.", reasoning,
                             "Make the question depend on this layer's specific idea and make "
                             "the wrong options closer."))


def check_question(explanation, q, depth):
    """Raise Rejected (with a reason) if the question is not fair or too easy,
    or CheckerError if the checker itself failed. Returns None if it passes."""
    _lesson_check(explanation, q)
    if depth >= BLIND_CHECK_FROM_DEPTH:
        _blind_check(q, depth)


def with_feedback(prompt, feedback):
    """Add the last attempt's problem to the prompt so the retry can fix it."""
    if not feedback:
        return prompt
    return (prompt + "\n\nYour previous attempt was rejected: " + feedback
            + "\nWrite a new version that fixes this problem.")


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
    # (deepest depth this tier covers, student level, description)
    (2, "middle school", """Difficulty: SURFACE (depth 1-2). Level: MIDDLE SCHOOL (ages 11-14).
- Language: short sentences and everyday words. Assume no background beyond
  what a middle schooler knows; explain every technical term.
- Explanation: introduce the idea in everyday words with one simple example.
- Question type: check the player understood the core idea. Describe a simple,
  new example (not the one in the explanation) and ask what it shows, or ask
  which statement correctly describes the idea.
- Wrong options: common beginner misconceptions. A careful reader rules them
  out quickly."""),
    (4, "high school", """Difficulty: SHALLOW (depth 3-4). Level: HIGH SCHOOL.
- Language: what a good high school class would use. Basic subject terms are
  fine once introduced; simple numbers or cause-and-effect chains are expected.
- Explanation: go past the basics; name the mechanism or the rule behind the
  idea, not just what happens.
- Question type: apply the idea. Give a short scenario the explanation did not
  mention and ask the player to predict what happens or choose what to do.
- Wrong options: near misses that would be right if one detail of the rule
  were different."""),
    (6, "first-year college", """Difficulty: DEEP (depth 5-6). Level: INTRO COLLEGE (first-year course).
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
    (None, "upper-level college", """Difficulty: CORE (depth 7 and below). Level: COLLEGE (upper-level course).
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


def _tier_for(depth):
    for tier in DIFFICULTY_TIERS:
        if tier[0] is None or depth <= tier[0]:
            return tier


def difficulty_for(depth):
    return _tier_for(depth)[2]


def level_for(depth):
    return _tier_for(depth)[1]


# What a layer's explanation covers. The first layer is a broad overview of the
# whole topic; every layer after it zooms in on one specific part.
FOCUS_OVERVIEW = """Focus: OVERVIEW. This is the first layer, so give a basic summary of
{topic} as a whole: what it is, the one or two big ideas behind it, and why it
matters. Do not zoom in on one detail yet.
- Question: check the player got the big picture (what the topic is or its main
  idea), not a specific fact.
- Tunnels: three main parts or branches of {topic}, each a clear step more
  specific than this overview."""

FOCUS_ZOOM = """Focus: ZOOM IN. {topic} is a more specific part of {parent}.
Teach ONE specific idea about {topic}; do not summarize {parent} again or give
a general overview.
- Tunnels: three narrower parts of {topic}, each more specific than this layer."""


def focus_for(topic, path, depth):
    if depth <= 1 or not path:
        return FOCUS_OVERVIEW.format(topic=topic)
    return FOCUS_ZOOM.format(topic=topic, parent=path[-1])


LAYER_PROMPT = """The player is digging into: {root}
Path so far: {path}
Next layer topic: {topic}
Depth: {depth} (1 is the surface; deeper layers must be harder)
Already covered, do not repeat: {covered}

{focus}

{difficulty}

Write this layer as JSON with exactly these fields:
{{
  "explanation": "at most 100 words, following the Focus above",
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
        focus=focus_for(topic, path, depth),
        difficulty=difficulty_for(depth),
        icons=json.dumps(ICONS),
    )

    last_error, feedback = None, None
    for attempt in range(1, MAX_TRIES + 1):
        try:
            layer = extract_json(ask_model(with_feedback(prompt, feedback)))
            validate_layer(layer)
            check_question(layer["explanation"], layer["question"], depth)
            layer["depth"] = depth  # set by our code, not trusted from the model
            layer["topic"] = topic  # always the player's chosen topic, set by our code
            shuffle_options(layer["question"])
            return layer
        except Rejected as e:
            last_error, feedback = e, e.reason
        except CheckerError as e:
            last_error = e  # keep the previous feedback; this one isn't the question's fault
        except (ValueError, json.JSONDecodeError) as e:
            last_error, feedback = e, f"the reply was not usable ({e})."
        logger.warning("layer %r depth %d, try %d/%d failed: %s",
                       topic, depth, attempt, MAX_TRIES, last_error)
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

    depth = layer.get("depth", 1)
    last_error, feedback = None, None
    for try_num in range(1, MAX_TRIES + 1):
        try:
            result = extract_json(ask_model(with_feedback(prompt, feedback)))
            _require(isinstance(result, dict), "reply must be a JSON object")
            _validate_explanation(result.get("explanation"))
            _validate_question(result.get("question"))
            check_question(result["explanation"], result["question"], depth)
            shuffle_options(result["question"])
            return {"explanation": result["explanation"], "style": style,
                    "question": result["question"]}
        except Rejected as e:
            last_error, feedback = e, e.reason
        except CheckerError as e:
            last_error = e
        except (ValueError, json.JSONDecodeError) as e:
            last_error, feedback = e, f"the reply was not usable ({e})."
        logger.warning("cave-in %r depth %d, try %d/%d failed: %s",
                       layer["topic"], depth, try_num, MAX_TRIES, last_error)
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
