--------------UP
-- Earlier device migrations (6570+) leave the session search_path at `device`.
-- Restore `public` so the TimescaleDB functions (create_hypertable,
-- add_*_policy) resolve — without this the migration fails on a fresh deploy.
SET search_path TO device, public;

-- Append-only journal of device-reported changes. FM already computes the delta
-- (component/field/prev->next) on every NotifyStatus, plus NotifyEvent; today it
-- is discarded. This is the source of truth for device troubleshooting/audit.
-- Current state lives in the in-memory device; telemetry lives in device.status
-- and device_em.stats — this table holds ONLY the changes, not state or firehose.
CREATE TABLE IF NOT EXISTS device.event_log (
    ts              TIMESTAMPTZ  NOT NULL,            -- device-reported time, preserved verbatim
    received_ts     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    shelly_id       VARCHAR(255) NOT NULL,
    organization_id VARCHAR(120),
    component       VARCHAR(64)  NOT NULL,            -- e.g. switch:0
    field           VARCHAR(128) NOT NULL,            -- e.g. output
    prev            JSONB,
    next            JSONB,
    kind            VARCHAR(24)  NOT NULL,            -- state_change | event | config
    source          VARCHAR(32)                       -- device | command | unknown
);

SELECT create_hypertable('device.event_log', 'ts', chunk_time_interval => INTERVAL '24 hours');

CREATE INDEX IF NOT EXISTS idx_device_event_log_shelly ON device.event_log (shelly_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_device_event_log_kind ON device.event_log (kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_device_event_log_org ON device.event_log (organization_id, ts DESC);

ALTER TABLE device.event_log SET (
    timescaledb.compress = true,
    timescaledb.compress_segmentby = 'shelly_id',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('device.event_log', compress_created_before => INTERVAL '24 hours');
-- Native chunk-drop retention (lock-free) — never a row-DELETE sweep.
SELECT add_retention_policy('device.event_log', INTERVAL '30 days');

-- Bulk insert; one round-trip per flush window (mirrors fn_audit_log_add_batch).
CREATE OR REPLACE FUNCTION device.fn_event_log_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    INSERT INTO device.event_log (
        ts, shelly_id, organization_id,
        component, field, prev, next, kind, source
    )
    SELECT
        COALESCE((e->>'ts')::timestamptz, NOW()),
        e->>'shelly_id',
        e->>'organization_id',
        e->>'component',
        e->>'field',
        e->'prev',
        e->'next',
        e->>'kind',
        e->>'source'
    FROM jsonb_array_elements(p_entries) e;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Paginated history read. NULL params mean "no filter on that field"; org is
-- NULL only for a platform-admin all-tenant query (callers fail closed to
-- their own org). Newest first; the index on (shelly_id, ts DESC) serves the
-- common per-device view.
CREATE OR REPLACE FUNCTION device.fn_event_log_query(
    p_organization_id TEXT,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_shelly_ids TEXT[],
    p_component TEXT,
    p_kind TEXT,
    p_limit INT,
    p_offset INT
)
RETURNS SETOF device.event_log
LANGUAGE sql
STABLE
AS $$
    SELECT *
    FROM device.event_log
    WHERE (p_organization_id IS NULL OR organization_id = p_organization_id)
      AND (p_from IS NULL OR ts >= p_from)
      AND (p_to IS NULL OR ts < p_to)
      AND (p_shelly_ids IS NULL OR shelly_id = ANY(p_shelly_ids))
      AND (p_component IS NULL OR component = p_component)
      AND (p_kind IS NULL OR kind = p_kind)
    ORDER BY ts DESC
    LIMIT p_limit OFFSET p_offset;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_event_log_query(
    TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT, TEXT, INT, INT
);
DROP FUNCTION IF EXISTS device.fn_event_log_add_batch(JSONB);
DROP TABLE IF EXISTS device.event_log;
