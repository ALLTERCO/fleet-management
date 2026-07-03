--------------UP
-- FM-issued scoped PATs. boundary_scope narrows the owner's effective
-- shape at the auth gate; can never escalate.
-- LINT-IGNORE: additive-only

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS fm_scoped_pats (
    token_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    user_id         text NOT NULL,
    boundary_scope  jsonb NOT NULL,
    audience        text[] NOT NULL DEFAULT '{}',
    purpose         text NOT NULL,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text NOT NULL,
    last_used_at    timestamptz,
    revoked_at      timestamptz
);

CREATE INDEX IF NOT EXISTS fm_scoped_pats_user_idx
    ON fm_scoped_pats (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS fm_scoped_pats_expires_idx
    ON fm_scoped_pats (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS fm_scoped_pats_purpose_idx
    ON fm_scoped_pats (tenant_id, purpose) WHERE revoked_at IS NULL;

--------------DOWN
DROP TABLE IF EXISTS organization.fm_scoped_pats;
