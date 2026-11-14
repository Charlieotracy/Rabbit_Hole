"""Plays one real run (no mocking) through two consecutive wrong answers.

Guards against the cave-in state bug: a wrong answer's new question and
answer_index must replace the run's stored state, so (a) each cave-in's
question differs from the one before it, and (b) the next answer is graded
against the latest question, not the original or a previous cave-in.

Uses whatever LLM mode .env is set to (FAKE_LLM=1 or a real model call).
"""

import pytest

from backend.api import main

ATTEMPTS = 8  # retries if option 0 happens to be correct and skips a cave-in


def _create_run(topic="black holes"):
    resp = main.create_run(main.RunRequest(topic=topic))
    assert isinstance(resp, dict) and "run_id" in resp, f"generate_layer failed: {resp}"
    return resp


def _answer(run_id, option_index):
    resp = main.answer_run(run_id, main.AnswerRequest(option_index=option_index))
    assert isinstance(resp, dict), f"answer call failed: {resp}"
    return resp


def test_two_consecutive_cave_ins_advance_state():
    for _ in range(ATTEMPTS):
        run_id = _create_run()["run_id"]

        first = _answer(run_id, 0)
        if first["correct"]:
            continue  # unlucky guess; retry with a fresh run
        cave_in_1 = first["cave_in"]

        second = _answer(run_id, 0)
        if second["correct"]:
            continue
        cave_in_2 = second["cave_in"]
        break
    else:
        pytest.fail(f"could not get two consecutive wrong answers in {ATTEMPTS} tries")

    # (a) the second cave-in is new content, not a repeat of the first.
    assert cave_in_1["question"] != cave_in_2["question"], (
        "second cave-in returned the same question as the first - "
        "node['question'] wasn't replaced after the first wrong answer"
    )

    # The run's stored question must be exactly what the player was just
    # shown (cave_in_2), not the original question or cave_in_1's.
    node = main.RUNS[run_id]["nodes"][main.RUNS[run_id]["current_node_id"]]
    assert node["question"]["text"] == cave_in_2["question"], (
        "run's stored question doesn't match the last cave-in returned to the player"
    )

    # (b) grading uses that latest state: submitting its own correct option
    # (never sent over the wire, so read server-side) must be graded correct.
    correct_index = node["question"]["answer_index"]
    third = _answer(run_id, correct_index)
    assert third["correct"] is True, (
        "answering cave_in_2's own correct option was graded as wrong - "
        "the run is still checking against stale question state"
    )
    assert len(third["tunnels"]) == 3
