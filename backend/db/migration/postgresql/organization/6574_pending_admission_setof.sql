--------------UP
-- SETOF makes missed-row explicit: 0 rows when no live intent.
-- Replaces the single-composite return that yielded an all-NULL row
-- on miss — brittle to detect from the JS side.

SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_pending_admission_reserve(TEXT);
DROP FUNCTION IF EXISTS organization.fn_pending_admission_finalize(TEXT, VARCHAR);

CREATE OR REPLACE FUNCTION organization.fn_pending_admission_reserve(
    p_shelly_id TEXT
)
RETURNS SETOF organization.pending_admission
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM organization.pending_admission
     WHERE shelly_id = p_shelly_id
       AND consumed_at IS NULL
       AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION organization.fn_pending_admission_finalize(
    p_shelly_id       TEXT,
    p_organization_id VARCHAR
)
RETURNS SETOF organization.pending_admission
LANGUAGE sql
AS $$
    UPDATE organization.pending_admission
       SET consumed_at = now()
     WHERE shelly_id = p_shelly_id
       AND organization_id = p_organization_id
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING *;
$$;

--------------DOWN
SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_pending_admission_reserve(TEXT);
DROP FUNCTION IF EXISTS organization.fn_pending_admission_finalize(TEXT, VARCHAR);

CREATE OR REPLACE FUNCTION organization.fn_pending_admission_reserve(
    p_shelly_id TEXT
)
RETURNS organization.pending_admission
LANGUAGE plpgsql
AS $$
DECLARE
    r organization.pending_admission;
BEGIN
    SELECT * INTO r
      FROM organization.pending_admission
     WHERE shelly_id = p_shelly_id
       AND consumed_at IS NULL
       AND expires_at > now();
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_pending_admission_finalize(
    p_shelly_id       TEXT,
    p_organization_id VARCHAR
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
       AND organization_id = p_organization_id
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING * INTO r;
    RETURN r;
END;
$$;
