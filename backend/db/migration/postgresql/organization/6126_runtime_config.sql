--------------UP
-- Runtime-mutable FM config shared across instances; envHash guards staleness.

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS system_runtime_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    env_hash    TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);

--------------DOWN
SET search_path TO organization;

DROP TABLE IF EXISTS system_runtime_config;
