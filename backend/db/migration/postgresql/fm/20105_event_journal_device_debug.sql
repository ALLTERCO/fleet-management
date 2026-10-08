--------------UP
SET search_path TO public;

-- A device in debug has every frame journaled until expires_at.
CREATE TABLE IF NOT EXISTS fm.event_journal_device_debug (
    organization_id VARCHAR(160) NOT NULL,
    device_id VARCHAR(160) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    set_by VARCHAR(160),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, device_id)
);

CREATE OR REPLACE FUNCTION fm.fn_event_journal_debug_set(
    p_organization_id VARCHAR,
    p_device_id VARCHAR,
    p_minutes INTEGER,
    p_user_id VARCHAR
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
    v_active INTEGER;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_minutes IS NULL OR p_minutes < 0 OR p_minutes > 240 THEN
        RAISE EXCEPTION 'debug minutes must be 0 to 240'
            USING ERRCODE = '22023', DETAIL = 'ValidationFailed';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE external_id = p_device_id
           AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'device not found'
            USING ERRCODE = 'P0002', DETAIL = 'ResourceNotFound';
    END IF;

    -- One writer per tenant at a time keeps the cap exact.
    PERFORM pg_advisory_xact_lock(hashtext('fm.event_journal_device_debug'),
                                  hashtext(p_organization_id));
    DELETE FROM fm.event_journal_device_debug
     WHERE organization_id = p_organization_id
       AND (expires_at <= clock_timestamp() OR device_id = p_device_id AND p_minutes = 0);
    IF p_minutes = 0 THEN
        RETURN NULL;
    END IF;

    SELECT count(*) INTO v_active
      FROM fm.event_journal_device_debug
     WHERE organization_id = p_organization_id
       AND device_id <> p_device_id;
    IF v_active >= 20 THEN
        RAISE EXCEPTION 'at most 20 devices per tenant can be in journal debug'
            USING ERRCODE = '23514', DETAIL = 'ResourceConflict';
    END IF;

    v_expires_at := clock_timestamp() + make_interval(mins => p_minutes);
    INSERT INTO fm.event_journal_device_debug (
        organization_id, device_id, expires_at, set_by
    ) VALUES (
        p_organization_id, p_device_id, v_expires_at, p_user_id
    )
    ON CONFLICT (organization_id, device_id) DO UPDATE
       SET expires_at = EXCLUDED.expires_at,
           set_by = EXCLUDED.set_by,
           updated_at = clock_timestamp();
    RETURN v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_debug_active()
RETURNS TABLE (
    organization_id VARCHAR,
    device_id VARCHAR,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT d.organization_id, d.device_id, d.expires_at
      FROM fm.event_journal_device_debug AS d
     WHERE d.expires_at > clock_timestamp();
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS fm.fn_event_journal_debug_active();
DROP FUNCTION IF EXISTS fm.fn_event_journal_debug_set(VARCHAR, VARCHAR, INTEGER, VARCHAR);
DROP TABLE IF EXISTS fm.event_journal_device_debug;
