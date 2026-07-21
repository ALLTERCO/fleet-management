--------------UP
ALTER TABLE device.event_log
    ADD COLUMN IF NOT EXISTS device_id INT;

UPDATE device.event_log e
   SET device_id = d.id
  FROM device.list d
 WHERE e.device_id IS NULL
   AND d.external_id = e.shelly_id
   AND (
       e.organization_id IS NULL
       OR d.organization_id = e.organization_id
   );

DO $$
DECLARE
    v_unresolved BIGINT;
BEGIN
    SELECT count(*) INTO v_unresolved
      FROM device.event_log
     WHERE device_id IS NULL;
    RAISE NOTICE 'device event owners unresolved after backfill: %',
        v_unresolved;
END;
$$;

ALTER TABLE device.event_log
    ADD CONSTRAINT event_log_device_fk
        FOREIGN KEY (device_id) REFERENCES device.list(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_device_event_log_device
    ON device.event_log (device_id, ts DESC);

CREATE OR REPLACE FUNCTION device.fn_event_log_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT;
    v_expected BIGINT;
BEGIN
    SELECT count(*) INTO v_expected
      FROM jsonb_array_elements(p_entries);

    INSERT INTO device.event_log (
        ts, device_id, shelly_id, organization_id,
        component, field, prev, next, kind, source
    )
    SELECT
        COALESCE((e->>'ts')::TIMESTAMPTZ, now()),
        owner.id,
        e->>'shelly_id',
        e->>'organization_id',
        e->>'component',
        e->>'field',
        e->'prev',
        e->'next',
        e->>'kind',
        e->>'source'
      FROM jsonb_array_elements(p_entries) e
      JOIN device.list owner
        ON owner.id = COALESCE(
            (e->>'device_id')::INT,
            (
                SELECT d.id
                  FROM device.list d
                 WHERE d.external_id = e->>'shelly_id'
                   AND (
                       e->>'organization_id' IS NULL
                       OR d.organization_id = e->>'organization_id'
                   )
                 LIMIT 1
            )
        )
       AND owner.external_id = e->>'shelly_id'
       AND (
           e->>'organization_id' IS NULL
           OR owner.organization_id = e->>'organization_id'
       );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> v_expected THEN
        RAISE EXCEPTION 'device event batch contains an unresolved owner'
            USING ERRCODE = '23503';
    END IF;
    RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS device.fn_event_log_query(
    TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT, TEXT, INT, INT
);
CREATE FUNCTION device.fn_event_log_query(
    p_organization_id TEXT,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_shelly_ids TEXT[],
    p_component TEXT,
    p_kind TEXT,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    received_ts TIMESTAMPTZ,
    device_id INT,
    shelly_id VARCHAR,
    organization_id VARCHAR,
    component VARCHAR,
    field VARCHAR,
    prev JSONB,
    next JSONB,
    kind VARCHAR,
    source VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.ts, e.received_ts, e.device_id, e.shelly_id,
           e.organization_id, e.component, e.field, e.prev, e.next,
           e.kind, e.source
      FROM device.event_log e
     WHERE (p_organization_id IS NULL
            OR e.organization_id = p_organization_id)
       AND (p_from IS NULL OR e.ts >= p_from)
       AND (p_to IS NULL OR e.ts < p_to)
       AND (
           p_shelly_ids IS NULL
           OR e.device_id IN (
               SELECT d.id
                 FROM device.list d
                WHERE d.external_id = ANY(p_shelly_ids)
                  AND (
                      p_organization_id IS NULL
                      OR d.organization_id = p_organization_id
                  )
           )
           OR (
               e.device_id IS NULL
               AND e.shelly_id = ANY(p_shelly_ids)
           )
       )
       AND (p_component IS NULL OR e.component = p_component)
       AND (p_kind IS NULL OR e.kind = p_kind)
     ORDER BY e.ts DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION device.fn_reassign_event_log_ownership(
    p_retained_device_id INT,
    p_temporary_device_id INT
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE device.event_log
       SET device_id = p_retained_device_id
     WHERE device_id = p_temporary_device_id;
$$;

--------------DOWN
-- Forward-only logical identity migration.
