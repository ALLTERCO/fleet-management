--------------UP
CREATE TABLE IF NOT EXISTS organization.zitadel_action_inbox (
    event_key TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK (
        action IN ('user.removed', 'user.grant.removed')
    ),
    user_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    source_ip TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'in_progress', 'done')
    ),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS zitadel_action_inbox_due_idx
    ON organization.zitadel_action_inbox (available_at, received_at)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS zitadel_action_inbox_claimed_idx
    ON organization.zitadel_action_inbox (claimed_at)
    WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS zitadel_action_inbox_done_idx
    ON organization.zitadel_action_inbox (processed_at)
    WHERE status = 'done';

--------------DOWN
DROP TABLE IF EXISTS organization.zitadel_action_inbox;
