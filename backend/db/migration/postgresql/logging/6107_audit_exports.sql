--------------UP
-- Audit-log export ownership + ticket persistence. Previously held in
-- process memory, which broke download-after-restart and download-on-
-- peer-pod flows. Owner + ticket TTL live in Postgres so authorization
-- survives across instances and restarts.

CREATE TABLE IF NOT EXISTS logging.audit_exports (
    filename     TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logging.audit_export_tickets (
    ticket       UUID PRIMARY KEY,
    filename     TEXT NOT NULL REFERENCES logging.audit_exports(filename) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_export_tickets_expires
    ON logging.audit_export_tickets (expires_at);

--------------DOWN
DROP TABLE IF EXISTS logging.audit_export_tickets;
DROP TABLE IF EXISTS logging.audit_exports;
