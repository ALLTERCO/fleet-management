--------------UP
-- LINT-IGNORE: additive-only (deliberate legacy function removal)
-- Reserve/finalize seam + cross-org guard for pending_admission.

SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_pending_admission_consume(TEXT);

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
    existing organization.pending_admission;
    r        organization.pending_admission;
BEGIN
    SELECT * INTO existing
      FROM organization.pending_admission
     WHERE shelly_id = p_shelly_id
       AND consumed_at IS NULL
       AND expires_at > now();

    IF FOUND AND existing.organization_id <> p_organization_id THEN
        RAISE EXCEPTION
            'pending_admission cross-org conflict for shelly_id=% live_org=% requested_org=%',
            p_shelly_id, existing.organization_id, p_organization_id
            USING ERRCODE = 'FM071';
    END IF;

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

-- Reserve: peek the live intent. Does NOT mark consumed; the caller
-- must call finalize() after the approve side-effects succeed.
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

-- Finalize: atomic single-use consume. The org guard prevents a
-- racing intent for a different org from being consumed under the
-- reserving caller. Returns the consumed row or 0 rows.
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

--------------DOWN
SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_pending_admission_finalize(TEXT, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_pending_admission_reserve(TEXT);

-- Restore previous behavior of fn_pending_admission_record (blind overwrite).
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
