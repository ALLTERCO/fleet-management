--------------UP
-- Debug capture of live em/em1 status values, off by default. An operator turns
-- it on for one device for a bounded time; the frames live in their own table,
-- never in device_em.stats, so billing, reports and the rollup cannot read
-- them. The capture row is the switch every process reads; frames cascade with
-- it, and a Timescale job deletes captures (and so their frames) once expired.
SET search_path TO device_em, public;

CREATE TABLE IF NOT EXISTS device_em.live_debug_capture (
    device INTEGER PRIMARY KEY,
    organization_id VARCHAR(160) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    set_by VARCHAR(160),
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS live_debug_capture_organization
    ON device_em.live_debug_capture (organization_id);

CREATE TABLE IF NOT EXISTS device_em.live_debug_frame (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device INTEGER NOT NULL
        REFERENCES device_em.live_debug_capture (device) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    component VARCHAR(32) NOT NULL,
    field VARCHAR(64) NOT NULL,
    val DOUBLE PRECISION NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS live_debug_frame_device_id
    ON device_em.live_debug_frame (device, id);

-- p_hours = 0 stops the capture and deletes its frames. A restart while one
-- runs moves the end and keeps what was captured.
CREATE OR REPLACE FUNCTION device_em.fn_live_debug_set(
    p_organization_id VARCHAR,
    p_shelly_id VARCHAR,
    p_hours INTEGER,
    p_user_id VARCHAR
)
RETURNS TABLE (device INTEGER, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
    v_device INTEGER;
    v_active INTEGER;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_hours IS NULL OR p_hours < 0 OR p_hours > 24 THEN
        RAISE EXCEPTION 'live debug hours must be 0 to 24'
            USING ERRCODE = '22023', DETAIL = 'ValidationFailed';
    END IF;
    SELECT l.id INTO v_device
      FROM device.list l
     WHERE l.external_id = p_shelly_id
       AND l.organization_id = p_organization_id;
    IF v_device IS NULL THEN
        RAISE EXCEPTION 'device not found'
            USING ERRCODE = 'P0002', DETAIL = 'ResourceNotFound';
    END IF;

    -- One writer per tenant at a time keeps the cap exact.
    PERFORM pg_advisory_xact_lock(hashtext('device_em.live_debug_capture'),
                                  hashtext(p_organization_id));
    DELETE FROM device_em.live_debug_capture c
     WHERE c.organization_id = p_organization_id
       AND (c.expires_at <= clock_timestamp()
            OR (c.device = v_device AND p_hours = 0));
    IF p_hours = 0 THEN
        RETURN QUERY SELECT v_device, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    SELECT count(*) INTO v_active
      FROM device_em.live_debug_capture c
     WHERE c.organization_id = p_organization_id
       AND c.device <> v_device;
    IF v_active >= 20 THEN
        RAISE EXCEPTION 'at most 20 devices per tenant can capture live EM values'
            USING ERRCODE = '23514', DETAIL = 'ResourceConflict';
    END IF;

    v_expires_at := clock_timestamp() + make_interval(hours => p_hours);
    INSERT INTO device_em.live_debug_capture AS c (
        device, organization_id, expires_at, set_by
    ) VALUES (
        v_device, p_organization_id, v_expires_at, p_user_id
    )
    ON CONFLICT ON CONSTRAINT live_debug_capture_pkey DO UPDATE
       SET expires_at = EXCLUDED.expires_at,
           set_by = EXCLUDED.set_by;
    RETURN QUERY SELECT v_device, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_live_debug_active()
RETURNS TABLE (device INTEGER, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE
AS $$
    SELECT c.device, c.expires_at
      FROM device_em.live_debug_capture c
     WHERE c.expires_at > clock_timestamp();
$$;

-- Only devices with a running capture take frames, so a process that has not
-- yet seen a stop cannot write past it.
CREATE OR REPLACE FUNCTION device_em.fn_live_debug_append(
    p_device INTEGER[],
    p_ts BIGINT[],
    p_component VARCHAR[],
    p_field VARCHAR[],
    p_val DOUBLE PRECISION[]
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO device_em.live_debug_frame (device, ts, component, field, val)
    SELECT f.device, to_timestamp(f.ts), f.component, f.field, f.val
      FROM unnest(p_device, p_ts, p_component, p_field, p_val)
           AS f(device, ts, component, field, val)
      JOIN device_em.live_debug_capture c
        ON c.device = f.device
       AND c.expires_at > clock_timestamp();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_live_debug_get(
    p_organization_id VARCHAR,
    p_shelly_id VARCHAR
)
RETURNS TABLE (device INTEGER, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE
AS $$
    SELECT l.id, c.expires_at
      FROM device.list l
      LEFT JOIN device_em.live_debug_capture c
        ON c.device = l.id
       AND c.organization_id = p_organization_id
       AND c.expires_at > clock_timestamp()
     WHERE l.external_id = p_shelly_id
       AND l.organization_id = p_organization_id;
$$;

-- Frames after p_after_id in capture order, tenant-checked through the capture.
CREATE OR REPLACE FUNCTION device_em.fn_live_debug_read(
    p_organization_id VARCHAR,
    p_device INTEGER,
    p_after_id BIGINT,
    p_limit INTEGER
)
RETURNS TABLE (
    id BIGINT,
    ts TIMESTAMPTZ,
    component VARCHAR,
    field VARCHAR,
    val DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT f.id, f.ts, f.component, f.field, f.val
      FROM device_em.live_debug_frame f
      JOIN device_em.live_debug_capture c ON c.device = f.device
     WHERE f.device = p_device
       AND c.organization_id = p_organization_id
       AND f.id > COALESCE(p_after_id, 0)
     ORDER BY f.id
     LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_live_debug_expire()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM device_em.live_debug_capture
     WHERE expires_at <= clock_timestamp();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE PROCEDURE device_em.job_expire_live_debug(job_id INT, config JSONB)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM device_em.fn_live_debug_expire();
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
         WHERE proc_schema = 'device_em' AND proc_name = 'job_expire_live_debug'
    ) THEN
        PERFORM add_job('device_em.job_expire_live_debug', INTERVAL '5 minutes',
                        config => '{}'::jsonb);
    END IF;
END;
$$;

--------------DOWN
SET search_path TO device_em, public;

DO $$
DECLARE
    v_job INTEGER;
BEGIN
    FOR v_job IN
        SELECT job_id FROM timescaledb_information.jobs
         WHERE proc_schema = 'device_em' AND proc_name = 'job_expire_live_debug'
    LOOP
        PERFORM delete_job(v_job);
    END LOOP;
END;
$$;

DROP PROCEDURE IF EXISTS device_em.job_expire_live_debug(INT, JSONB);
DROP FUNCTION IF EXISTS device_em.fn_live_debug_expire();
DROP FUNCTION IF EXISTS device_em.fn_live_debug_read(VARCHAR, INTEGER, BIGINT, INTEGER);
DROP FUNCTION IF EXISTS device_em.fn_live_debug_get(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS device_em.fn_live_debug_append(INTEGER[], BIGINT[], VARCHAR[], VARCHAR[], DOUBLE PRECISION[]);
DROP FUNCTION IF EXISTS device_em.fn_live_debug_active();
DROP FUNCTION IF EXISTS device_em.fn_live_debug_set(VARCHAR, VARCHAR, INTEGER, VARCHAR);
DROP TABLE IF EXISTS device_em.live_debug_frame;
DROP TABLE IF EXISTS device_em.live_debug_capture;
