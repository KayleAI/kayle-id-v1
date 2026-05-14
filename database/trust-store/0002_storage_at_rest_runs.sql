CREATE TABLE IF NOT EXISTS storage_at_rest_runs (
  run_day TEXT PRIMARY KEY NOT NULL,
  completed_at_ms INTEGER NOT NULL
);
