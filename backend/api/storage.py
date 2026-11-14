import logging
import os
import queue
import threading
from pathlib import Path
from typing import Optional

from databricks import sql
from dotenv import load_dotenv

logger = logging.getLogger("rabbit_hole.storage")

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST")
DATABRICKS_HTTP_PATH = os.environ.get("DATABRICKS_HTTP_PATH")
DATABRICKS_TOKEN = os.environ.get("DATABRICKS_TOKEN")

ENABLED = bool(DATABRICKS_HOST and DATABRICKS_HTTP_PATH and DATABRICKS_TOKEN)
if not ENABLED:
    logger.warning(
        "DATABRICKS_HOST/DATABRICKS_HTTP_PATH/DATABRICKS_TOKEN not fully set; "
        "analytics writes to Databricks are disabled."
    )

_connection = None

# All statements run serially on one background thread, so a slow or
# unreachable warehouse only delays analytics, never a gameplay request,
# and the single shared connection is never touched from two threads at once.
_write_queue: "queue.Queue" = queue.Queue()


def _get_connection():
    global _connection
    if _connection is None:
        _connection = sql.connect(
            server_hostname=DATABRICKS_HOST,
            http_path=DATABRICKS_HTTP_PATH,
            access_token=DATABRICKS_TOKEN,
        )
    return _connection


def _run_statement(statement: str, parameters: Optional[dict]) -> None:
    global _connection
    try:
        conn = _get_connection()
        with conn.cursor() as cursor:
            cursor.execute(statement, parameters)
    except Exception:
        logger.exception("Databricks write failed: %s", statement.split("\n")[0].strip())
        try:
            if _connection is not None:
                _connection.close()
        except Exception:
            pass
        _connection = None


def _worker() -> None:
    while True:
        statement, parameters = _write_queue.get()
        _run_statement(statement, parameters)


threading.Thread(target=_worker, daemon=True).start()


def _execute(statement: str, parameters: Optional[dict] = None) -> None:
    if not ENABLED:
        return
    _write_queue.put((statement, parameters))


def init_tables() -> None:
    _execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            run_id STRING,
            topic STRING,
            started_at TIMESTAMP,
            ended_at TIMESTAMP,
            max_depth INT,
            first_try_count INT
        )
        """
    )
    _execute(
        """
        CREATE TABLE IF NOT EXISTS answers (
            run_id STRING,
            node_id STRING,
            topic STRING,
            depth INT,
            option_index INT,
            correct BOOLEAN,
            created_at TIMESTAMP
        )
        """
    )
    _execute(
        """
        CREATE TABLE IF NOT EXISTS cave_ins (
            run_id STRING,
            node_id STRING,
            topic STRING,
            depth INT,
            attempt INT,
            created_at TIMESTAMP
        )
        """
    )


def record_run_start(run_id: str, topic: str) -> None:
    _execute(
        """
        INSERT INTO runs (run_id, topic, started_at, ended_at, max_depth, first_try_count)
        VALUES (:run_id, :topic, current_timestamp(), NULL, 1, 0)
        """,
        {"run_id": run_id, "topic": topic},
    )


def record_run_end(run_id: str, max_depth: int, first_try_count: int) -> None:
    _execute(
        """
        UPDATE runs
        SET ended_at = current_timestamp(), max_depth = :max_depth, first_try_count = :first_try_count
        WHERE run_id = :run_id
        """,
        {"run_id": run_id, "max_depth": max_depth, "first_try_count": first_try_count},
    )


def record_answer(
    run_id: str,
    node_id: str,
    topic: str,
    depth: int,
    option_index: int,
    correct: bool,
) -> None:
    _execute(
        """
        INSERT INTO answers (run_id, node_id, topic, depth, option_index, correct, created_at)
        VALUES (:run_id, :node_id, :topic, :depth, :option_index, :correct, current_timestamp())
        """,
        {
            "run_id": run_id,
            "node_id": node_id,
            "topic": topic,
            "depth": depth,
            "option_index": option_index,
            "correct": correct,
        },
    )


def record_cave_in(run_id: str, node_id: str, topic: str, depth: int, attempt: int) -> None:
    _execute(
        """
        INSERT INTO cave_ins (run_id, node_id, topic, depth, attempt, created_at)
        VALUES (:run_id, :node_id, :topic, :depth, :attempt, current_timestamp())
        """,
        {"run_id": run_id, "node_id": node_id, "topic": topic, "depth": depth, "attempt": attempt},
    )
