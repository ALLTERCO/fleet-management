--------------UP
-- The PL/pgSQL output variables (`ts`, `device_id`, `value`) shadowed CTE
-- columns with the same names, so every real call failed with SQLSTATE 42702.
-- A SQL-language function has no output-variable ambiguity and preserves the
-- organization-scoped signature used by status history and virtual backfill.
CREATE OR REPLACE FUNCTION device.fn_status_timeline(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_field           TEXT,
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ
)
RETURNS TABLE (
    ts         TIMESTAMPTZ,
    device_id  INTEGER,
    value      NUMERIC,
    prev_value NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    WITH allowed AS (
        SELECT dl.id
          FROM device.list dl
         WHERE dl.id = ANY(p_device_ids)
           AND (
                p_organization_id IS NULL OR
                dl.organization_id = p_organization_id
           )
    ),
    ordered AS (
        SELECT
            s.ts AS event_ts,
            s.id AS source_device_id,
            s.value AS event_value,
            LAG(s.value) OVER (
                PARTITION BY s.id ORDER BY s.ts
            ) AS previous_value
          FROM device.status s
         WHERE s.id IN (SELECT allowed.id FROM allowed)
           AND s.field = p_field
           AND s.ts <= p_to
    ),
    changes AS (
        SELECT
            ordered.event_ts,
            ordered.source_device_id,
            ordered.event_value,
            ordered.previous_value
          FROM ordered
         WHERE ordered.previous_value IS DISTINCT FROM ordered.event_value
            OR ordered.previous_value IS NULL
    ),
    initial AS (
        SELECT pre.event_ts, pre.source_device_id,
               pre.event_value, pre.previous_value
          FROM (
                SELECT DISTINCT ON (changes.source_device_id)
                    p_from AS event_ts,
                    changes.source_device_id,
                    changes.event_value,
                    NULL::NUMERIC AS previous_value
                  FROM changes
                 WHERE changes.event_ts <= p_from
                 ORDER BY changes.source_device_id, changes.event_ts DESC
          ) pre
        UNION ALL
        SELECT fresh.event_ts, fresh.source_device_id,
               fresh.event_value, fresh.previous_value
          FROM (
                SELECT DISTINCT ON (c.source_device_id)
                    p_from AS event_ts,
                    c.source_device_id,
                    c.event_value,
                    NULL::NUMERIC AS previous_value
                  FROM changes c
                 WHERE c.event_ts > p_from
                   AND NOT EXISTS (
                        SELECT 1
                          FROM changes earlier
                         WHERE earlier.source_device_id = c.source_device_id
                           AND earlier.event_ts <= p_from
                   )
                 ORDER BY c.source_device_id, c.event_ts ASC
          ) fresh
    )
    SELECT initial.event_ts,
           initial.source_device_id,
           initial.event_value,
           initial.previous_value
      FROM initial
    UNION ALL
    SELECT changes.event_ts,
           changes.source_device_id,
           changes.event_value,
           changes.previous_value
      FROM changes
     WHERE changes.event_ts > p_from
       AND changes.event_ts <= p_to
     ORDER BY 2, 1;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_status_timeline(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_field           TEXT,
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ
)
RETURNS TABLE (
    ts         TIMESTAMPTZ,
    device_id  INTEGER,
    value      NUMERIC,
    prev_value NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH allowed AS (
        SELECT id FROM device.list
         WHERE id = ANY(p_device_ids)
           AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ),
    ordered AS (
        SELECT
            s.ts,
            s.id AS device_id,
            s.value,
            LAG(s.value) OVER (PARTITION BY s.id ORDER BY s.ts) AS prev_val
        FROM device.status s
        WHERE s.id IN (SELECT id FROM allowed)
          AND s.field = p_field
          AND s.ts <= p_to
    ),
    changes AS (
        SELECT ts, device_id, value, prev_val
        FROM ordered
        WHERE prev_val IS DISTINCT FROM value OR prev_val IS NULL
    ),
    initial AS (
        SELECT ts, device_id, value, prev_val FROM (
            SELECT DISTINCT ON (device_id)
                p_from AS ts, device_id, value, NULL::NUMERIC AS prev_val
            FROM changes
            WHERE ts <= p_from
            ORDER BY device_id, ts DESC
        ) pre_window
        UNION ALL
        SELECT ts, device_id, value, prev_val FROM (
            SELECT DISTINCT ON (c.device_id)
                p_from AS ts, c.device_id, c.value, NULL::NUMERIC AS prev_val
            FROM changes c
            WHERE c.ts > p_from
              AND NOT EXISTS (
                    SELECT 1 FROM changes c2
                    WHERE c2.device_id = c.device_id AND c2.ts <= p_from
                )
            ORDER BY c.device_id, c.ts ASC
        ) new_devices
    )
    SELECT ts, device_id, value, prev_val AS prev_value FROM initial
    UNION ALL
    SELECT ts, device_id, value, prev_val AS prev_value FROM changes
    WHERE ts > p_from AND ts <= p_to
    ORDER BY device_id, ts;
END;
$$;
