--------------UP
-- Admission intents recorded by Discovery.AdmitDevice. When the
-- targeted device reconnects, the WaitingRoom intake path checks
-- this table first: a live row short-circuits the waiting room and
-- the device is admitted directly into the requesting orgs scope.

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS organization.pending_admission (
    shelly_id        TEXT PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    group_id         INTEGER,
    created_by       VARCHAR(120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_admission_expires
    ON organization.pending_admission (expires_at)
    WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION organization.fn_pending_admission_record(
    p_shelly_id       TEXT,
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_created_by      VARCHAR,
    p_ttl_seconds     INTEGER
)
RETURNS organization.pending_admission
LANGUAGE plpgsql
AS $$
DECLARE
    r organization.pending_admission;
BEGIN
    INSERT INTO organization.pending_admission (
        shelly_id, organization_id, group_id, created_by, expires_at
    ) VALUES (
        p_shelly_id, p_organization_id, p_group_id, p_created_by,
        now() + (p_ttl_seconds || ' seconds')::interval
    )
    ON CONFLICT (shelly_id) DO UPDATE
        SET organization_id = EXCLUDED.organization_id,
            group_id        = EXCLUDED.group_id,
            created_by      = EXCLUDED.created_by,
            created_at      = now(),
            expires_at      = EXCLUDED.expires_at,
            consumed_at     = NULL
    RETURNING * INTO r;
    RETURN r;
END;
$$;

-- Returns the live intent (consumed_at IS NULL, not expired) and
-- atomically marks it consumed. Returns no rows if nothing applies.
CREATE OR REPLACE FUNCTION organization.fn_pending_admission_consume(
    p_shelly_id TEXT
)
RETURNS organization.pending_admission
LANGUAGE plpgsql
AS $$
DECLARE
    r organization.pending_admission;
BEGIN
    UPDATE organization.pending_admission
       SET consumed_at = now()
     WHERE shelly_id = p_shelly_id
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING * INTO r;
    RETURN r;
END;
$$;

--------------DOWN
SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_pending_admission_consume(TEXT);
DROP FUNCTION IF EXISTS organization.fn_pending_admission_record(TEXT, VARCHAR, INTEGER, VARCHAR, INTEGER);
DROP INDEX IF EXISTS organization.pending_admission_expires;
DROP TABLE IF EXISTS organization.pending_admission;
