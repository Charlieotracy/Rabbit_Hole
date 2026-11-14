-- Dashboard queries for the Rabbit Hole analytics tables.
-- Columns are exactly as created in backend/api/storage.py:
--   runs      (run_id, topic, started_at, ended_at, max_depth, first_try_count)
--   answers   (run_id, node_id, topic, depth, option_index, correct, created_at)
--   cave_ins  (run_id, node_id, topic, depth, attempt, created_at)
-- node_id (e.g. "n1") is only unique within a run, so queries that need a
-- globally unique layer instance key it on (run_id, node_id) together.


-- 1. Concepts ranked by cave-in count (which ideas people struggle with)
-- Chart: horizontal bar chart, topic vs. cave_in_count, sorted descending.
SELECT
    topic,
    COUNT(*) AS cave_in_count
FROM cave_ins
GROUP BY topic
ORDER BY cave_in_count DESC
LIMIT 20;


-- 2. First-try rate: correct first attempts as a share of all layers attempted
-- Chart: single-value / KPI counter (a percentage).
WITH first_attempts AS (
    SELECT
        run_id,
        node_id,
        correct,
        ROW_NUMBER() OVER (PARTITION BY run_id, node_id ORDER BY created_at) AS attempt_num
    FROM answers
)
SELECT
    ROUND(
        SUM(CASE WHEN correct THEN 1 ELSE 0 END) / COUNT(*),
        4
    ) AS first_try_rate,
    SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS first_try_correct,
    COUNT(*) AS layers_attempted
FROM first_attempts
WHERE attempt_num = 1;


-- 3. Distribution of max_depth across runs (how deep people get)
-- Chart: histogram / bar chart, max_depth vs. run_count.
-- Only finished runs: max_depth is a placeholder (1) until GET /runs/{id}
-- (the end screen) stamps the real value via storage.record_run_end.
SELECT
    max_depth,
    COUNT(*) AS run_count
FROM runs
WHERE ended_at IS NOT NULL
GROUP BY max_depth
ORDER BY max_depth;


-- 4. Most-dug topics
-- Chart: bar chart (top-N leaderboard), topic vs. times_dug.
-- Every layer actually dug into gets at least one answers row (even a
-- first-try-correct one), so counting distinct (run_id, node_id) pairs per
-- topic in `answers` counts each dug layer once, regardless of how many
-- wrong attempts it took.
SELECT
    topic,
    COUNT(DISTINCT CONCAT(run_id, '-', node_id)) AS times_dug
FROM answers
GROUP BY topic
ORDER BY times_dug DESC
LIMIT 20;
