"""The LLM part of Rabbit Hole: prompts, model calls, parsing, and checking.

Everything the player reads comes from the functions in this file:
  generate_explanation()          -> streams a layer's explanation text
  generate_question()             -> a checked question for an explanation
  generate_details()              -> a layer's artifact and three tunnels
  generate_cave_in_explanation()  -> streams a re-explanation after a wrong answer
  generate_layer() / cave_in()    -> the same pieces run together, not streamed
  generate_ahead()                -> next layers for all three tunnels, in parallel

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

_SYSTEM_BASE = (
    "You write content for Rabbit Hole, a learning game where players dig into a "
    "topic one layer at a time and must answer a question to go deeper. "
    "The level rises as the player digs: it starts at middle school and ends at "
    "college. Follow the level asked for at each depth. At every level, teach one "
    "idea at a time and explain any term the player has not met yet."
)
SYSTEM = _SYSTEM_BASE + " Reply with a single JSON object and nothing else."  # JSON calls
SYSTEM_TEXT = _SYSTEM_BASE + " Reply with plain text only."  # streamed explanations


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


def stream_model(prompt, temperature=0.7, model=None):
    """Send one prompt and yield the plain-text reply in chunks as it arrives.
    The request is only sent once the caller starts iterating."""
    stream = _get_client().chat.completions.create(
        model=model or MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_TEXT},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        stream=True,
    )
    for chunk in stream:
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        text = _answer_text(getattr(choices[0].delta, "content", None))
        if text:
            yield text


def _answer_text(content):
    """The answer text in a reply or a streamed chunk. Reasoning models can send
    a list of parts (thinking parts, then answer parts); keep only the answer."""
    if isinstance(content, str):
        return content
    texts = []
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                kind, text = part.get("type"), part.get("text")
            else:  # the SDK sometimes gives objects instead of dicts
                kind, text = getattr(part, "type", None), getattr(part, "text", None)
            if kind == "text" and text:
                texts.append(text)
    return "".join(texts)


def text_from_content(content):
    """Most models reply with one string. Reasoning models can reply with a list
    of parts (a thinking part, then the answer part). Keep only the answer text."""
    if isinstance(content, str):
        return content
    text = _answer_text(content)
    if text:
        return text
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
    _validate_details(layer)


def _validate_details(details):
    """The artifact and tunnels, from generate_details or a whole layer."""
    _require(isinstance(details, dict), "reply must be a JSON object")
    artifact = details.get("artifact")
    _require(isinstance(artifact, dict) and isinstance(artifact.get("name"), str),
             "artifact.name missing")
    if artifact.get("icon") not in ICONS:
        artifact["icon"] = "gem"  # unknown icon: fall back instead of failing

    tunnels = details.get("tunnels")
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

# Failures come in two kinds:
#   hard - the question could mark a player wrong for a right answer (not
#          answerable from the lesson, an arguable wrong option, zero or two
#          correct options, a wrong answer key, an unusable reply, or the
#          checker itself failing). Never shipped.
#   soft - the question is fair but flawed (wording gives it away, too easy,
#          options too long or uneven). Retried, but if every try has a soft
#          problem, the best one is shipped and logged instead of ending the run.

class Rejected(ValueError):
    """A hard failure: the checker turned the question down; `reason` says why."""

    def __init__(self, reason):
        super().__init__(f"checker rejected the question: {reason}")
        self.reason = reason


class CheckerError(Exception):
    """The checker's own reply was unusable. Not the question's fault, so
    nothing is fed back, but the question is still not trusted."""


# The blind check (would a student get it right without reading the lesson?)
# only counts from this depth down. At the surface, a big-picture question a
# student could already answer is fine. The level check in the same call runs
# at every depth.
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
  "answerable_from_lesson": true only if someone with no prior knowledge of the
    subject could pick the right option and rule out the others using only the
    lesson, otherwise false,
  "problem": "one sentence on the main problem with this question, or empty if none"}}"""

# One checker call does both the level check and the blind check, so keeping
# difficulty in line costs no extra model call from BLIND_CHECK_FROM_DEPTH on.
STUDENT_CHECK_PROMPT = """Rabbit Hole teaches a topic in layers that get gradually harder. This quiz
question is for depth {depth}.

The level asked for at this depth:
{level_here}

{level_easier}

{level_harder}

Question: {question}
Options:
{options}

1. Level: compare the question with the levels above. Look at the kind of
thinking it asks for and how close the wrong options are to the right one.
"too easy" if it fits the easier level better, "too hard" if it fits the harder
level better, otherwise "right". Difficulty should rise gradually, so only call
it off if it clearly matches a neighboring level better.

2. Guessing: a typical {level} student has NOT read the lesson and sees only the
question. How would they do? Also look for wording that gives the answer away
even to someone who knows nothing: one option longer, more specific, or more
carefully hedged than the rest; the only option that fits the question's
grammar; giveaway words; or three options that are obviously silly.

Reply with JSON only:
{{"level_reasoning": "how the question compares with the levels above",
  "level": "too easy" or "right" or "too hard",
  "reasoning": "how the student would approach it without the lesson, and any wording clues",
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


def _student_problems(q, depth):
    """Soft problems: is the question at this depth's level, and (from
    BLIND_CHECK_FROM_DEPTH on) would the player get it without the lesson?
    Returns a list of reasons (empty if none)."""
    blind = depth >= BLIND_CHECK_FROM_DEPTH
    level = level_for(depth)
    easier, here, harder = _neighbor_levels(DIFFICULTY_TIERS, depth, _question_level_text)
    try:
        reply = _ask_checker(STUDENT_CHECK_PROMPT.format(
            depth=depth, level=level, question=q["text"], options=_options_text(q),
            level_here=here,
            level_easier=f"One level easier (earlier layers):\n{easier}" if easier
            else "There is no easier level; this is the first one.",
            level_harder=f"One level harder (deeper layers):\n{harder}" if harder
            else "There is no harder level; this is the deepest one."))
    except CheckerError as e:
        if blind:
            raise  # the blind check is part of trusting the question
        logger.warning("level check depth %d skipped: %s", depth, e)
        return []

    problems = []
    verdict = str(reply.get("level", "")).strip().lower()
    logger.info("level check depth %d: question is %s", depth, verdict or "?")
    if verdict in ("too easy", "too hard"):
        direction = ("Make it harder: ask for the kind of thinking this level asks for and "
                     "make the wrong options closer." if verdict == "too easy" else
                     "Make it easier: ask for the kind of thinking this level asks for and "
                     "make the wrong options easier to rule out.")
        problems.append(_join(f"the question is {verdict} for depth {depth}:",
                              _sentence(reply.get("level_reasoning")), direction))
    if not blind:
        return problems

    reasoning = _sentence(reply.get("reasoning"))
    if reply.get("wording_gives_it_away") is True:
        problems.append(_join("the wording gives the answer away without reading the explanation:",
                              reasoning,
                              "Make all four options match in length, detail, and grammar."))
    if (reply.get("likely_pick") == q["answer_index"]
            and str(reply.get("confidence", "")).strip().lower() == "high"):
        problems.append(_join(f"too easy: a {level} student who has not read the explanation "
                              "would confidently pick the right answer.", reasoning,
                              "Make the question depend on this layer's specific idea and make "
                              "the wrong options closer."))
    return problems


# Option length limits, checked in code before any checker call. Looser than
# the prompt asks for (10 words, within 3), so small overruns pass and only
# clear giveaways, like one option much longer than the rest, are flagged.
# Too long or uneven options are a soft problem: repaired if possible, retried
# otherwise, and shipped as a last resort.
MAX_OPTION_WORDS = 12
MAX_OPTION_WORD_GAP = 4


def _length_problem(q):
    """What's wrong with the options' lengths, or None if they're fine."""
    counts = [len(o.split()) for o in q["options"]]
    for i, n in enumerate(counts):
        if n > MAX_OPTION_WORDS:
            return (f'option "{q["options"][i]}" is {n} words; keep every option '
                    "to at most 10 words.")
    longest, shortest = max(counts), min(counts)
    if longest - shortest > MAX_OPTION_WORD_GAP:
        return (f'the options range from {shortest} to {longest} words; '
                f'"{q["options"][counts.index(longest)]}" stands out. Keep all four '
                "within 3 words of each other.")
    return None


REPAIR_OPTIONS_PROMPT = """The answer options for this quiz question are too long or uneven: {problem}

Question: {question}
Options:
{options}
The correct option is number {correct}.

Rewrite ONLY the options:
- Each option is at most 10 words, and all four are within 3 words of each other.
- Keep each option's meaning. Shorten by cutting extra detail, not by making it vague.
- Option {correct} must stay the one correct answer; the others must stay wrong
  but believable.
- Write all four in the same grammatical form.
- Keep them in the same order.

Reply with JSON only:
{{"options": ["four", "rewritten", "options", "here"]}}"""


def _repair_options(q, problem):
    """Shorten/even out the options of an otherwise usable question, keeping its
    text and which option is correct. Cheaper than writing a new question, and
    keeps a question that was only too wordy. Returns the repaired question, or
    None if the repair didn't fix it (the caller keeps the original)."""
    prompt = REPAIR_OPTIONS_PROMPT.format(
        problem=problem, question=q["text"], options=_options_text(q), correct=q["answer_index"])
    try:
        reply = extract_json(ask_model(prompt))
        repaired = dict(q, options=reply.get("options") if isinstance(reply, dict) else None)
        _validate_question(repaired)
    except (ValueError, json.JSONDecodeError) as e:
        logger.warning("option repair failed (%s); keeping the original options", e)
        return None
    still = _length_problem(repaired)
    if still:
        logger.warning("option repair did not fix lengths (%s); keeping the original options", still)
        return None
    logger.info("repaired option lengths: %s", problem)
    return repaired


def check_question(explanation, q, depth):
    """Check a question. Raises Rejected for a hard failure (not fair), or
    CheckerError if the checker itself failed. Otherwise returns the list of
    soft problems (empty if the question is clean)."""
    soft = []
    length = _length_problem(q)
    if length:
        soft.append(length)
    _lesson_check(explanation, q)  # hard: raises Rejected
    soft += _student_problems(q, depth)
    return soft


def with_feedback(prompt, feedback):
    """Add the last attempt's problem to the prompt so the retry can fix it."""
    if not feedback:
        return prompt
    return (prompt + "\n\nYour previous attempt was rejected: " + feedback
            + "\nWrite a new version that fixes this problem.")


# ----------------------------------------------------------------- the layer
#
# A layer is made in pieces, so the explanation can be shown while it is
# still being written:
#   generate_explanation()  streams the lesson text (plain text, no JSON)
#   generate_question()     writes the quiz question for that text, checked
#   generate_details()      picks the artifact and the three tunnels
# generate_layer() runs all three and returns the whole layer at once, for
# callers that don't stream. Cave-ins are split the same way.

# Used by QUESTION_PROMPT. No curly braces in here: it is pasted into strings
# that go through str.format().
QUESTION_RULES = """Question rules:
- Never ask the player to just find a phrase from the explanation.
- Exactly one option is correct, and someone who understood the explanation can
  tell which one. The other three must be clearly wrong to them, and only to them.
- No prior knowledge needed: someone who has never studied this subject must be
  able to answer using only the lesson. Do not use any technical term, fact, or
  name in the question or options that the lesson does not give or explain, and
  never make a wrong option one that can only be ruled out with outside knowledge.

Rules for the four options:
- Each option is a short phrase of at most 10 words.
- All four options are about the same length (within 3 words of each other).
- Write every option in the same grammatical form, and make them the same kind
  of thing (all causes, all numbers, all places, ...).
- The correct option must not be the most hedged one.
- No "all of the above" or "none of the above", and no giveaway words like
  "always" or "never" that only appear in wrong options."""

# Cave-in explanations often use an analogy or example; the question must still
# test the idea itself. Harmless for normal layers, so it is always included.
CONCEPT_RULES = """- If the lesson uses an analogy or example, the question tests the real idea,
  not the analogy or example. The question and all four options are about the
  topic itself, in its real terms: do not mention the analogy's or example's
  characters, objects, or details, and do not ask what part of it stands for
  what. Someone who understood the idea but skipped the analogy or example must
  still be able to answer it."""

# How hard a layer is, by depth. Each tier asks for a different kind of
# question, so going deeper changes what the player has to do, not just the
# subject. The explanation call gets the language and explanation guidance;
# the question call gets the question type and wrong-option guidance.
# No curly braces in here (pasted into str.format() templates).
DIFFICULTY_TIERS = [
    # (deepest depth this tier covers, student level, header,
    #  explanation guidance, question guidance)
    (2, "middle school",
     "Difficulty: SURFACE (depth 1-2). Level: MIDDLE SCHOOL (ages 11-14).",
     """- Language: short sentences and everyday words. Assume no background beyond
  what a middle schooler knows; explain every technical term.
- Explanation: introduce the idea in everyday words with one simple example.""",
     """- Question type: check the player understood the core idea. Describe a simple,
  new example (not the one in the explanation) and ask what it shows, or ask
  which statement correctly describes the idea.
- Wrong options: common beginner misconceptions in everyday words. They should
  sound reasonable to someone who skipped the lesson, but anyone who read it
  rules them out quickly. Do not make them technical or near misses."""),
    (4, "high school",
     "Difficulty: SHALLOW (depth 3-4). Level: HIGH SCHOOL.",
     """- Language: what a good high school class would use. Basic subject terms are
  fine once introduced; simple numbers or cause-and-effect chains are expected.
- Explanation: go past the basics; name the mechanism or the rule behind the
  idea, not just what happens.""",
     """- Question type: apply the idea. Give a short scenario the explanation did not
  mention and ask the player to predict what happens or choose what to do.
- Wrong options: believable misconceptions about THIS topic, not vague or
  obviously silly answers. Build each one from:
  * a common misconception a beginner would actually hold about this idea
  * a statement that is true on its own but does not answer this question
  * a near miss that would be right if one detail of the rule were different
    (cause swapped with effect, wrong direction, wrong amount)
  All four options use the same level of detail and the same vocabulary, and
  the correct option is not the only one that uses words from the lesson. Any
  subject term in an option must come from the lesson itself."""),
    (6, "first-year college",
     "Difficulty: DEEP (depth 5-6). Level: INTRO COLLEGE (first-year course).",
     """- Language: proper subject vocabulary, used precisely. Assume the player
  remembers the earlier layers on their path; define new terms briefly.
- Explanation: cover the reason why, including a limit, exception, or
  condition where the idea stops working.""",
     """- Question type: reason about cause, condition, or exception. Ask why something
  happens, what would change if one factor changed, or which situation the idea
  does NOT apply to.
- Wrong options: all sound expert, using the same vocabulary as the correct
  one. Each is a real, related effect or a correct statement about a
  neighboring idea, taken from what the lesson says, so only someone who
  grasped the exact reason can pick the right one."""),
    (None, "upper-level college",
     "Difficulty: CORE (depth 7 and below). Level: COLLEGE (upper-level course).",
     """- Language: the precise terms and distinctions a college course in this
  subject would use. Still define anything not covered earlier on the path.
- Explanation: treat the player as a strong learner; give the precise version
  of the idea, including how it connects to an earlier topic on their path.
  State every fact a two-step reasoning question would need, so a question
  about it can be answered from this explanation alone.""",
     """- Question type: multi-step reasoning. The player must combine two facts from
  the explanation, or follow a chain of cause and effect two steps, to reach the
  answer. A single fact alone must not be enough.
- Wrong options: each is the answer you reach if you skip one step, apply the
  idea one step too far, or use only one of the two facts."""),
]


def _tier_for(depth):
    for tier in DIFFICULTY_TIERS:
        if tier[0] is None or depth <= tier[0]:
            return tier


def level_for(depth):
    return _tier_for(depth)[1]


def explanation_difficulty(depth):
    tier = _tier_for(depth)
    return tier[2] + "\n" + tier[3]


def question_difficulty(depth):
    return _question_level_text(_tier_for(depth))


def _question_level_text(tier):
    return tier[2] + "\n" + tier[4]


def _neighbor_levels(tiers, depth, describe):
    """(easier, this, harder) descriptions of the tiers around `depth`, so the
    checker can tell whether something rises gradually. None at either end."""
    i = next(i for i, t in enumerate(tiers) if t[0] is None or depth <= t[0])
    easier = describe(tiers[i - 1]) if i > 0 else None
    harder = describe(tiers[i + 1]) if i + 1 < len(tiers) else None
    return easier, describe(tiers[i]), harder


# What a layer covers. The first layer is a broad overview of the whole topic;
# every layer after it zooms in on one specific part.
FOCUS_OVERVIEW = """Focus: OVERVIEW. This is the first layer, so give a basic summary of
{topic} as a whole: what it is, the one or two big ideas behind it, and why it
matters. Do not zoom in on one detail yet."""

FOCUS_ZOOM = """Focus: ZOOM IN. {topic} is a more specific part of {parent}.
Teach ONE specific idea about {topic}; do not summarize {parent} again or give
a general overview."""

QUESTION_FOCUS_OVERVIEW = """Focus: this lesson is an overview of the whole topic. Check the player got
the big picture (what the topic is or its main idea), not a specific fact."""

QUESTION_FOCUS_ZOOM = "Focus: check the ONE specific idea this lesson teaches."

# How niche the tunnels out of a layer are, by that layer's depth. They narrow
# slowly: right after the first layer they are still broad, well-known parts
# of the topic, and only the deep layers lead into specialist corners.
# Titles may also get a little longer and more specific with depth.
# (deepest layer depth this applies to, max title words asked for, template)
TUNNEL_TIERS = [
    (1, 3, """Tunnels: three main parts or branches of {topic} that most people have
heard of, each a clear step more specific than this overview. Pick the big,
well-known areas, not specialist details."""),
    (3, 3, """Tunnels: three well-known parts of {topic}, each a bit narrower than this
layer but still broad: the kind of thing a textbook chapter or a popular
article would cover. Not specialist details or obscure cases yet."""),
    (5, 4, """Tunnels: three more specific parts of {topic}, such as a particular
mechanism, a named case or example, or a key debate. Narrower than this layer,
but still things a keen student of the subject would come across."""),
    (None, 5, """Tunnels: three niche parts of {topic}: specialist details, edge cases,
lesser-known findings, or open questions that only someone deep into the
subject would know about. Each clearly narrower than this layer."""),
]


def _is_overview(path, depth):
    return depth <= 1 or not path


def focus_for(topic, path, depth):
    if _is_overview(path, depth):
        return FOCUS_OVERVIEW.format(topic=topic)
    return FOCUS_ZOOM.format(topic=topic, parent=path[-1])


def question_focus_for(depth):
    return QUESTION_FOCUS_OVERVIEW if depth <= 1 else QUESTION_FOCUS_ZOOM


TUNNEL_TITLE_RULE = """
Each tunnel is just the name of a subject, at most {words} words, like a chapter
title. Not a sentence, a question, or a description of what the layer will teach."""


def _tunnel_tier(path, depth):
    if _is_overview(path, depth):
        depth = 1
    for tier in TUNNEL_TIERS:
        if tier[0] is None or depth <= tier[0]:
            return tier


def tunnel_max_words(path, depth):
    """Longest tunnel title accepted at this depth: one word of slack over
    what the prompt asks for, so only clearly wordy titles are retried."""
    return _tunnel_tier(path, depth)[1] + 1


def tunnels_focus_for(topic, path, depth):
    _, words, template = _tunnel_tier(path, depth)
    return template.format(topic=topic) + TUNNEL_TITLE_RULE.format(words=words)


TUNNEL_CHECK_PROMPT = """Rabbit Hole lets the player dig from a broad topic into narrower and narrower
subtopics. Each layer's tunnels should be a little more specific than the
layer they leave from, never a sudden jump into specialist detail.

Path so far: {path}
Current layer (depth {depth}): {topic}
Tunnels out of this layer:
{tunnels}

How niche the tunnels at this depth should be:
{level_here}

{level_broader}

{level_niche}

Judge every tunnel in order. Give your reasoning before each verdict:
- "too broad": not narrower than {topic}, or repeats something on the path
- "too niche": fits the more niche level better; a jump only a specialist
  would follow from here
- "right": otherwise. Only call it off if it is clearly off.

Reply with JSON only:
{{"tunnels": [
    {{"why": "how niche this tunnel is compared with the levels above", "verdict": "too broad" or "right" or "too niche"}},
    ... one entry per tunnel, in order (3 total)
  ]}}"""


def _tunnel_level_problems(topic, path, depth, tunnels):
    """Soft problems: are the tunnels a gradual step narrower than this layer,
    at this depth's niche level? Returns a list of reasons (empty if none).
    A failed check is logged and treated as a pass, so it never blocks a run."""
    tier_depth = 1 if _is_overview(path, depth) else depth
    broader, here, niche = _neighbor_levels(
        TUNNEL_TIERS, tier_depth, lambda t: t[2].format(topic=topic))
    try:
        reply = _ask_checker(TUNNEL_CHECK_PROMPT.format(
            path=" -> ".join(path) if path else "(this is the first layer)",
            depth=depth, topic=topic,
            tunnels="\n".join(f"{i}. {t}" for i, t in enumerate(tunnels)),
            level_here=here,
            level_broader=f"One level broader (earlier layers):\n{broader}" if broader
            else "There is no broader level; this is the first one.",
            level_niche=f"One level more niche (deeper layers):\n{niche}" if niche
            else "There is no more niche level; this is the deepest one."))
        judged = reply.get("tunnels")
        if not (isinstance(judged, list) and len(judged) == len(tunnels)
                and all(isinstance(j, dict) for j in judged)):
            raise CheckerError("checker did not judge all 3 tunnels")
    except CheckerError as e:
        logger.warning("tunnel level check %r depth %d skipped: %s", topic, depth, e)
        return []

    verdicts = [str(j.get("verdict", "")).strip().lower() for j in judged]
    logger.info("tunnel level check %r depth %d: %s", topic, depth,
                ", ".join(f"{t} = {v or '?'}" for t, v in zip(tunnels, verdicts)))
    problems = []
    for tunnel, verdict, j in zip(tunnels, verdicts, judged):
        if verdict in ("too broad", "too niche"):
            fix = ("Pick something a step narrower than this layer." if verdict == "too broad"
                   else "Pick something only a step narrower than this layer, at this depth's level.")
            problems.append(_join(f'tunnel "{tunnel}" is {verdict} for depth {depth}:',
                                  _sentence(j.get("why")), fix))
    return problems


def _context(topic, path):
    """The where-are-we fields shared by the explanation and details prompts."""
    return {
        "root": path[0] if path else topic,
        "path": " -> ".join(path) if path else "(this is the first layer)",
        "covered": ", ".join(path) if path else "nothing yet",
    }


EXPLANATION_PROMPT = """The player is digging into: {root}
Path so far: {path}
This layer's topic: {topic}
Depth: {depth} (1 is the surface; deeper layers must be harder)
Already covered, do not repeat: {covered}

{focus}

{difficulty}

Write this layer's explanation: at most 100 words, following the Focus above.
A quiz question will be written from it afterwards, so state the idea clearly
enough that it can be tested from this text alone.
Reply with the explanation text only: no heading, no JSON, no question."""

QUESTION_PROMPT = """Write one quiz question for this Rabbit Hole lesson.

Lesson (depth {depth}):
{explanation}

{focus}

{difficulty}
{missed}
Reply with JSON only:
{{
  "text": "the question",
  "options": ["four", "answer", "choices", "here"],
  "answer_index": the position (0-3) of the one correct option
}}

Rules:
- The question must be answerable from the lesson alone.
""" + CONCEPT_RULES + "\n\n" + QUESTION_RULES

MISSED_NOTE = """
The player just got this question on the same idea wrong:
{question}
Ask a NEW question, not that one reworded. Keep it at this layer's difficulty:
the lesson may be clearer now, but the question must not get easier.
"""

DETAILS_PROMPT = """The player is digging into: {root}
Path so far: {path}
This layer's topic: {topic}
Already covered, do not repeat: {covered}

This layer's explanation:
{explanation}

Pick this layer's artifact and the three tunnels the player can dig into next.
{tunnels}

Reply with JSON only:
{{
  "artifact": {{
    "name": "a real object, discovery, person, or moment tied to this topic",
    "icon": one of {icons}
  }},
  "tunnels": ["three", "different", "subtopics"]
}}

Rules:
- Tunnels go deeper from this layer, differ from each other, and avoid covered topics."""


def generate_explanation(topic, path, depth):
    """Stream this layer's explanation. Yields text chunks as the model writes
    them; join them for the full text. `path` is the list of topics dug so far,
    oldest first."""
    if FAKE:
        yield from _fake_stream(_fake_layer(topic, depth)["explanation"])
        return
    prompt = EXPLANATION_PROMPT.format(
        **_context(topic, path),
        topic=topic,
        depth=depth,
        focus=focus_for(topic, path, depth),
        difficulty=explanation_difficulty(depth),
    )
    yield from stream_model(prompt)


def generate_question(explanation, depth, missed_question=None):
    """Write a question for `explanation` and run it past the checker.
    Returns {"text", "options", "answer_index"} with the options shuffled.
    `missed_question` (cave-ins) is the question the player just got wrong,
    so the new one isn't a reworded copy.

    Every problem found is fed into the next try. A question with a hard
    failure is never returned. If every try has a problem but at least one
    had only soft ones, the best of those (fewest soft problems) is returned
    and logged. Raises RuntimeError only if all MAX_TRIES failed hard."""
    if FAKE:
        return _fake_question(cave_in=missed_question is not None)

    prompt = QUESTION_PROMPT.format(
        explanation=explanation,
        depth=depth,
        focus=question_focus_for(depth),
        difficulty=question_difficulty(depth),
        missed=MISSED_NOTE.format(question=missed_question) if missed_question else "",
    )
    last_error, feedback = None, None
    best = None  # (question, soft problems): the best fair-but-flawed try so far
    for attempt in range(1, MAX_TRIES + 1):
        try:
            q = extract_json(ask_model(with_feedback(prompt, feedback)))
            _validate_question(q)
            q = {"text": q["text"], "options": q["options"], "answer_index": q["answer_index"]}
            problem = _length_problem(q)
            if problem:  # fix just the options rather than writing a new question
                q = _repair_options(q, problem) or q
            soft = check_question(explanation, q, depth)
            if not soft:
                return shuffle_options(q)
            if best is None or len(soft) <= len(best[1]):
                best = (q, soft)
            last_error = "soft: " + " | ".join(soft)
            feedback = " ".join(soft)
        except Rejected as e:
            last_error, feedback = e, e.reason
        except CheckerError as e:
            last_error = e  # keep the previous feedback; this one isn't the question's fault
        except (ValueError, json.JSONDecodeError) as e:
            last_error, feedback = e, f"the reply was not usable ({e})."
        logger.warning("question depth %d, try %d/%d failed: %s",
                       depth, attempt, MAX_TRIES, last_error)
    if best is not None:
        q, soft = best
        logger.warning("question depth %d: shipping a fair question with soft problems "
                       "after %d tries: %s", depth, MAX_TRIES, " | ".join(soft))
        return shuffle_options(q)
    raise RuntimeError(f"Could not generate a question: {last_error}")


def generate_details(topic, path, depth, explanation):
    """Pick the layer's artifact and its three tunnels.
    Returns {"artifact": {"name", "icon"}, "tunnels": [3 strings]}."""
    if FAKE:
        fake = _fake_layer(topic, depth)
        return {"artifact": fake["artifact"], "tunnels": fake["tunnels"]}

    prompt = DETAILS_PROMPT.format(
        **_context(topic, path),
        topic=topic,
        explanation=explanation,
        tunnels=tunnels_focus_for(topic, path, depth),
        icons=json.dumps(ICONS),
    )
    last_error, feedback = None, None
    best = None  # (reply, soft problems): the best usable try so far
    for attempt in range(1, MAX_TRIES + 1):
        try:
            details = extract_json(ask_model(with_feedback(prompt, feedback)))
            _validate_details(details)
            result = {"artifact": details["artifact"], "tunnels": details["tunnels"]}
            # Soft problems: retried, but if every try has one, the best
            # usable reply is shipped rather than ending the run. Long titles
            # are caught in code first, which saves the checker call.
            max_words = tunnel_max_words(path, depth)
            long = [t for t in result["tunnels"] if len(t.split()) > max_words]
            if long:
                soft = [f"these tunnel titles are too long: {long}. Each tunnel is just "
                        f"a subject name of at most {max_words - 1} words."]
            else:
                soft = _tunnel_level_problems(topic, path, depth, result["tunnels"])
            if not soft:
                return result
            if best is None or len(soft) <= len(best[1]):
                best = (result, soft)
            last_error = "soft: " + " | ".join(soft)
            feedback = " ".join(soft)
        except (ValueError, json.JSONDecodeError) as e:
            last_error, feedback = e, f"the reply was not usable ({e})."
        logger.warning("details %r depth %d, try %d/%d failed: %s",
                       topic, depth, attempt, MAX_TRIES, last_error)
    if best is not None:
        result, soft = best
        logger.warning("details %r depth %d: shipping tunnels with soft problems after "
                       "%d tries: %s", topic, depth, MAX_TRIES, " | ".join(soft))
        return result
    raise RuntimeError(f"Could not pick artifact and tunnels for {topic!r}: {last_error}")


def _full_explanation(make_stream, label):
    """Collect a streamed explanation for callers that don't stream. Nobody has
    seen it yet, so an unusable one (empty or too long) is simply regenerated."""
    last_error = None
    for attempt in range(1, MAX_TRIES + 1):
        text = "".join(make_stream()).strip()
        try:
            _validate_explanation(text)
            return text
        except ValueError as e:
            last_error = e
            logger.warning("explanation %s, try %d/%d failed: %s",
                           label, attempt, MAX_TRIES, e)
    raise RuntimeError(f"Could not generate explanation for {label}: {last_error}")


def generate_layer(topic, path, depth):
    """Make one whole layer without streaming: the explanation, then its
    question and its artifact/tunnels in parallel. `path` is the list of
    topics dug so far, oldest first."""
    if FAKE:
        return _fake_layer(topic, depth)

    explanation = _full_explanation(
        lambda: generate_explanation(topic, path, depth), f"layer {topic!r}")
    with ThreadPoolExecutor(max_workers=2) as pool:
        question = pool.submit(generate_question, explanation, depth)
        details = pool.submit(generate_details, topic, path, depth, explanation)
        question, details = question.result(), details.result()
    return {
        "topic": topic,  # always the player's chosen topic, set by our code
        "depth": depth,
        "explanation": explanation,
        "question": question,
        "artifact": details["artifact"],
        "tunnels": details["tunnels"],
    }


# ------------------------------------------------------------------ cave-ins

CAVE_IN_EXPLANATION_PROMPT = """The player got a question wrong and needs the idea explained again.

Topic: {topic}
Original explanation:
{explanation}

Question they missed: {question}
They chose: {chosen}
Correct answer: {correct}

Explain the SAME idea again using a different style: {style}.
The style is only a way in. If you use an analogy or example, also state the
real idea plainly, in the topic's own terms, so a question about the idea
itself can be answered from your explanation alone.
Make it clearer, not simpler: keep this layer's level.

{difficulty}

At most 100 words. Reply with the explanation text only: no heading, no JSON,
no question."""


def cave_in_style(attempt):
    """`attempt` counts cave-ins on this layer (0 for the first), so each one
    uses a different style."""
    return STYLES[attempt % len(STYLES)]


def generate_cave_in_explanation(layer, chosen_index, attempt):
    """Stream the re-explanation after a wrong answer. `layer` carries the
    question the player just missed. Yields text chunks; the style used is
    cave_in_style(attempt)."""
    style = cave_in_style(attempt)
    if FAKE:
        yield from _fake_stream(_fake_cave_in(layer, style)["explanation"])
        return
    q = layer["question"]
    prompt = CAVE_IN_EXPLANATION_PROMPT.format(
        topic=layer["topic"],
        explanation=layer["explanation"],
        question=q["text"],
        chosen=q["options"][chosen_index] if 0 <= chosen_index < 4 else "(no answer)",
        correct=q["options"][q["answer_index"]],
        style=style,
        difficulty=explanation_difficulty(layer.get("depth", 1)),
    )
    yield from stream_model(prompt)


def cave_in(layer, chosen_index, attempt):
    """Re-explain after a wrong answer without streaming: the new explanation,
    then a new checked question for it. Returns {explanation, style, question}."""
    style = cave_in_style(attempt)
    if FAKE:
        return _fake_cave_in(layer, style)

    explanation = _full_explanation(
        lambda: generate_cave_in_explanation(layer, chosen_index, attempt),
        f"cave-in {layer['topic']!r}")
    question = generate_question(explanation, layer.get("depth", 1),
                                 missed_question=layer["question"]["text"])
    return {"explanation": explanation, "style": style, "question": question}


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

def _fake_stream(text):
    """Yield canned text a word at a time, like a streamed reply."""
    for i, word in enumerate(text.split(" ")):
        yield word if i == 0 else " " + word


def _fake_question(cave_in=False):
    if cave_in:
        return {"text": "New question on this idea?",
                "options": ["Right answer", "Wrong A", "Wrong B", "Wrong C"],
                "answer_index": 0}
    return {"text": "Which option is correct?",
            "options": ["Wrong A", "Right answer", "Wrong B", "Wrong C"],
            "answer_index": 1}


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
