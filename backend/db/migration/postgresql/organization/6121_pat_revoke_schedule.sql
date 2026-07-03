--------------UP
-- Durable schedule for delayed PAT revocations (User.RotatePAT graceMs).
-- Survives FM restart, drained by patRevokeWorker.

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS pat_revoke_schedule (
    id          bigserial PRIMARY KEY,
    user_id     text NOT NULL,
    token_id    text NOT NULL,
    revoke_at   timestamptz NOT NULL,
    status      text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'in_progress', 'done', 'failed')),
    last_error  text,
    attempts    int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS pat_revoke_schedule_due_idx
    ON pat_revoke_schedule (revoke_at, id)
 WHERE status IN ('queued', 'in_progress');

--------------DOWN
SET search_path TO organization;

DROP TABLE IF EXISTS pat_revoke_schedule;
