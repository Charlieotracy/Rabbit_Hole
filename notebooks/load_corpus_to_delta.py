"""Loads notebooks/wikipedia_corpus.csv into a Delta table in Databricks.

Same connection approach as backend/api/storage.py: databricks-sql-connector
against the SQL warehouse named in .env at the repo root. Re-runnable --
each run replaces the table's contents with a fresh load of the CSV.

Change Data Feed and a primary key are enabled on the table because
notebooks/build_index.py needs both to sync a Vector Search index over it.
"""

import csv
import sys
from pathlib import Path

from databricks import sql
from dotenv import load_dotenv
import os

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST")
DATABRICKS_HTTP_PATH = os.environ.get("DATABRICKS_HTTP_PATH")
DATABRICKS_TOKEN = os.environ.get("DATABRICKS_TOKEN")

CSV_PATH = Path(__file__).resolve().parent / "wikipedia_corpus.csv"
TABLE_NAME = "wikipedia_passages"  # lands in the default catalog/schema, alongside runs/answers/cave_ins
BATCH_SIZE = 50

CREATE_TABLE_SQL = f"""
CREATE OR REPLACE TABLE {TABLE_NAME} (
    id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    passage_text STRING NOT NULL,
    article_title STRING,
    article_url STRING,
    source STRING
)
TBLPROPERTIES (delta.enableChangeDataFeed = true)
"""

ADD_PK_SQL = f"ALTER TABLE {TABLE_NAME} ADD CONSTRAINT {TABLE_NAME}_pk PRIMARY KEY (id)"


def read_rows() -> list:
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load() -> None:
    if not (DATABRICKS_HOST and DATABRICKS_HTTP_PATH and DATABRICKS_TOKEN):
        sys.exit("DATABRICKS_HOST/DATABRICKS_HTTP_PATH/DATABRICKS_TOKEN must be set in .env")

    rows = read_rows()
    print(f"Read {len(rows)} rows from {CSV_PATH}")

    conn = sql.connect(
        server_hostname=DATABRICKS_HOST,
        http_path=DATABRICKS_HTTP_PATH,
        access_token=DATABRICKS_TOKEN,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(CREATE_TABLE_SQL)
            cursor.execute(ADD_PK_SQL)

            for start in range(0, len(rows), BATCH_SIZE):
                batch = rows[start : start + BATCH_SIZE]
                values_sql = ", ".join(
                    f"(:passage_text{i}, :article_title{i}, :article_url{i}, :source{i})"
                    for i in range(len(batch))
                )
                params = {}
                for i, row in enumerate(batch):
                    params[f"passage_text{i}"] = row["passage_text"]
                    params[f"article_title{i}"] = row["article_title"]
                    params[f"article_url{i}"] = row["article_url"]
                    params[f"source{i}"] = row["source"]
                cursor.execute(
                    f"INSERT INTO {TABLE_NAME} "
                    f"(passage_text, article_title, article_url, source) VALUES {values_sql}",
                    params,
                )
                print(f"  inserted rows {start + 1}-{start + len(batch)}")

            cursor.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}")
            (count,) = cursor.fetchone()
            print(f"\n{TABLE_NAME} now has {count} rows")
    finally:
        conn.close()


if __name__ == "__main__":
    load()
