--------------UP
-- Close a cross-org TOCTOU: the pre-SELECT check is not atomic with the upsert,
-- so a concurrent admit from another org could pass it and the unconditional
-- ON CONFLICT overwrite the org. Guard the upsert to same-org or
-- consumed/expired rows; an active cross-org row blocks it and we raise.
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
        WHERE organization.pending_admission.organization_id
                  = EXCLUDED.organization_id
           OR organization.pending_admission.consumed_at IS NOT NULL
           OR organization.pending_admission.expires_at <= now()
    RETURNING * INTO r;

    -- No row returned = the upsert hit an active row of another org (the racing
    -- admit the pre-SELECT missed). Raise the same cross-org error atomically.
    IF r.shelly_id IS NULL THEN
        SELECT * INTO existing
          FROM organization.pending_admission
         WHERE shelly_id = p_shelly_id;
        RAISE EXCEPTION
            'pending_admission cross-org conflict for shelly_id=% live_org=% requested_org=%',
            p_shelly_id, existing.organization_id, p_organization_id
            USING ERRCODE = 'FM071';
    END IF;

    RETURN r;
END;
$$;
--------------DOWN
-- Restore the prior (unguarded) upsert body.
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
