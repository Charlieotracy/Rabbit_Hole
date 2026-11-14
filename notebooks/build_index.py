"""Creates a Databricks Vector Search index over wikipedia_passages.passage_text.

Picks an embedding model by actually listing this workspace's serving
endpoints rather than assuming one exists, preferring
EMBEDDING_ENDPOINT_PREFERENCE order below; prints whichever one it used.

Run after notebooks/load_corpus_to_delta.py (the source table needs Change
Data Feed and a primary key, which that script already sets up).
"""

import os
import sys
import time
from pathlib import Path

from databricks.sdk import WorkspaceClient
from databricks.vector_search.client import VectorSearchClient
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST")
DATABRICKS_TOKEN = os.environ.get("DATABRICKS_TOKEN")

SOURCE_TABLE = "workspace.default.wikipedia_passages"
VECTOR_SEARCH_ENDPOINT_NAME = "rabbit_hole_vector_search"
INDEX_NAME = "workspace.default.wikipedia_passages_index"
EMBEDDING_SOURCE_COLUMN = "passage_text"
PRIMARY_KEY = "id"

# In preference order: Databricks' flagship general-text-embedding model
# first, then other embedding-task endpoints this workspace happens to have.
EMBEDDING_ENDPOINT_PREFERENCE = [
    "databricks-gte-large-en",
    "databricks-bge-large-en",
]

POLL_SECONDS = 30
MAX_POLLS = 40  # 20 minutes


def pick_embedding_endpoint(w: WorkspaceClient) -> str:
    """Lists this workspace's serving endpoints and picks one whose task is
    an embeddings task, preferring EMBEDDING_ENDPOINT_PREFERENCE order."""
    available = [
        ep.name
        for ep in w.serving_endpoints.list()
        if getattr(ep, "task", None) == "llm/v1/embeddings"
    ]
    if not available:
        sys.exit("No embedding-task serving endpoint found on this workspace.")

    for preferred in EMBEDDING_ENDPOINT_PREFERENCE:
        if preferred in available:
            print(f"Embedding endpoints available: {available}")
            print(f"Picked: {preferred!r} (preferred general-text-embedding model)")
            return preferred

    chosen = available[0]
    print(f"Embedding endpoints available: {available}")
    print(f"None of the preferred names matched; picked: {chosen!r}")
    return chosen


def ensure_vector_search_endpoint(client: VectorSearchClient) -> None:
    existing = client.list_endpoints().get("endpoints", [])
    if any(ep["name"] == VECTOR_SEARCH_ENDPOINT_NAME for ep in existing):
        print(f"Vector Search endpoint {VECTOR_SEARCH_ENDPOINT_NAME!r} already exists.")
    else:
        print(f"Creating Vector Search endpoint {VECTOR_SEARCH_ENDPOINT_NAME!r} ...")
        client.create_endpoint(name=VECTOR_SEARCH_ENDPOINT_NAME, endpoint_type="STANDARD")

    for attempt in range(1, MAX_POLLS + 1):
        status = client.get_endpoint(VECTOR_SEARCH_ENDPOINT_NAME)
        state = status.get("endpoint_status", {}).get("state", "UNKNOWN")
        print(f"  [{attempt}/{MAX_POLLS}] endpoint state: {state}")
        if state == "ONLINE":
            return
        time.sleep(POLL_SECONDS)
    sys.exit(f"Vector Search endpoint did not come online within {MAX_POLLS * POLL_SECONDS}s.")


def ensure_index(client: VectorSearchClient, embedding_endpoint: str) -> None:
    try:
        client.get_index(VECTOR_SEARCH_ENDPOINT_NAME, INDEX_NAME)
        print(f"Index {INDEX_NAME!r} already exists.")
        return
    except Exception:
        pass

    print(f"Creating Delta Sync index {INDEX_NAME!r} over {SOURCE_TABLE}.{EMBEDDING_SOURCE_COLUMN} ...")
    client.create_delta_sync_index(
        endpoint_name=VECTOR_SEARCH_ENDPOINT_NAME,
        index_name=INDEX_NAME,
        source_table_name=SOURCE_TABLE,
        pipeline_type="TRIGGERED",
        primary_key=PRIMARY_KEY,
        embedding_source_column=EMBEDDING_SOURCE_COLUMN,
        embedding_model_endpoint_name=embedding_endpoint,
    )

    for attempt in range(1, MAX_POLLS + 1):
        index = client.get_index(VECTOR_SEARCH_ENDPOINT_NAME, INDEX_NAME)
        status = index.describe().get("status", {})
        state = status.get("detailed_state") or status.get("ready")
        print(f"  [{attempt}/{MAX_POLLS}] index state: {state}")
        if status.get("ready"):
            return
        time.sleep(POLL_SECONDS)
    print(f"Index creation still in progress after {MAX_POLLS * POLL_SECONDS}s; check the workspace UI for final status.")


def main() -> None:
    if not (DATABRICKS_HOST and DATABRICKS_TOKEN):
        sys.exit("DATABRICKS_HOST/DATABRICKS_TOKEN must be set in .env")

    w = WorkspaceClient(host=f"https://{DATABRICKS_HOST}", token=DATABRICKS_TOKEN)
    embedding_endpoint = pick_embedding_endpoint(w)

    vs_client = VectorSearchClient(
        workspace_url=f"https://{DATABRICKS_HOST}",
        personal_access_token=DATABRICKS_TOKEN,
        disable_notice=True,
    )
    ensure_vector_search_endpoint(vs_client)
    ensure_index(vs_client, embedding_endpoint)

    print(f"\nDone. Embedding model used: {embedding_endpoint!r}")
    print(f"Index: {INDEX_NAME!r} on endpoint {VECTOR_SEARCH_ENDPOINT_NAME!r}")


if __name__ == "__main__":
    main()
