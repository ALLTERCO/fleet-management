--------------UP
-- Redis-first snapshots are a hot write path. The previous batch function
-- took SHARE ROW EXCLUSIVE on device.list, which blocked every concurrent
-- INSERT/UPDATE. PostgreSQL's unique-index arbiter makes the set-based UPSERT
-- atomic per external_id; the retired-identity trigger remains the race-safe
-- final guard.
SET search_path TO device, public;

CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE sql
AS
$$
    WITH input AS MATERIALIZED (
        SELECT DISTINCT ON (external_id)
               external_id,
               jdoc
        FROM (
            SELECT NULLIF(e.entry->>'external_id', '')::VARCHAR(50) AS external_id,
                   NULLIF(e.entry->'jdoc', 'null'::jsonb) AS jdoc,
                   e.ordinality
            FROM jsonb_array_elements(
                     CASE
                         WHEN jsonb_typeof(p_entries) = 'array' THEN p_entries
                         ELSE '[]'::jsonb
                     END
                 ) WITH ORDINALITY
                 AS e(entry, ordinality)
        ) raw
        WHERE external_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM device.retired_external_identity retired
              WHERE retired.external_id = raw.external_id
          )
        ORDER BY external_id, ordinality DESC
    ),
    upserted AS (
        INSERT INTO device.list AS target (external_id, jdoc)
        SELECT external_id, jdoc
        FROM input
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc = COALESCE(EXCLUDED.jdoc, target.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING 1
    )
    SELECT count(*)::BIGINT FROM upserted;
$$;

--------------DOWN
SET search_path TO device, public;

CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_entries IS NULL
        OR jsonb_typeof(p_entries) <> 'array'
        OR jsonb_array_length(p_entries) = 0
    THEN
        RETURN 0;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    WITH input AS (
        SELECT DISTINCT ON (external_id)
               external_id,
               jdoc
        FROM (
            SELECT NULLIF(e.entry->>'external_id', '')::VARCHAR(50) AS external_id,
                   NULLIF(e.entry->'jdoc', 'null'::jsonb) AS jdoc,
                   e.ordinality
            FROM jsonb_array_elements(p_entries) WITH ORDINALITY
                 AS e(entry, ordinality)
        ) raw
        WHERE external_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM device.retired_external_identity retired
              WHERE retired.external_id = raw.external_id
          )
        ORDER BY external_id, ordinality DESC
    ),
    upserted AS (
        INSERT INTO device.list AS target (external_id, jdoc)
        SELECT external_id, jdoc
        FROM input
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc = COALESCE(EXCLUDED.jdoc, target.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM upserted;

    RETURN v_count;
END;
$$;
