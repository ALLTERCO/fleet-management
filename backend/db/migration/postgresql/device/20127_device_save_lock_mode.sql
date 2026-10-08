--------------UP
-- A snapshot save locked its rows FOR UPDATE, which conflicts with the
-- FOR KEY SHARE an event write takes on the same device, so the two waited on
-- each other. The save writes only jdoc and updated, never a key column, so
-- FOR NO KEY UPDATE keeps it serialized with other saves and with a purge
-- (DELETE takes FOR UPDATE) without blocking event writes. Event writes lock
-- owners in the same external_id order, so they cannot deadlock with a
-- writer that locks in that order.
CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_updated  VARCHAR[];
    v_inserted BIGINT;
BEGIN
    -- Rows are locked in external_id order, so concurrent batches cannot deadlock.
    -- NO KEY UPDATE: the save changes no key column, so event writes that only
    -- need the key (FOR KEY SHARE) do not wait. A purge still blocks it.
    WITH entry AS MATERIALIZED (
        SELECT * FROM device.fn_snapshot_entries(p_entries)
    ),
    locked AS (
        SELECT target.id, entry.jdoc
        FROM device.list target
        JOIN entry ON entry.external_id = target.external_id
        ORDER BY target.external_id
        FOR NO KEY UPDATE OF target
    ),
    updated AS (
        UPDATE device.list AS target
           SET jdoc    = COALESCE(locked.jdoc, target.jdoc),
               updated = now()::TIMESTAMPTZ
          FROM locked
         WHERE target.id = locked.id
        RETURNING target.external_id
    )
    SELECT COALESCE(array_agg(updated.external_id), '{}')
      INTO v_updated
      FROM updated;

    WITH inserted AS (
        INSERT INTO device.list AS target (external_id, jdoc)
        SELECT entry.external_id, entry.jdoc
        FROM device.fn_snapshot_entries(p_entries) entry
        WHERE entry.external_id <> ALL (v_updated)
          AND NOT EXISTS (
              SELECT 1
              FROM device.deleted_external_identity deleted
              WHERE deleted.external_id = entry.external_id
          )
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc    = COALESCE(EXCLUDED.jdoc, target.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM inserted;

    RETURN cardinality(v_updated) + v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_event_log_add_batch(p_entries JSONB)
RETURNS TABLE (accepted BIGINT, skipped BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_accepted BIGINT;
    v_skipped BIGINT;
    v_rejected BIGINT;
BEGIN
    WITH entries AS MATERIALIZED (
        SELECT e.entry,
               e.entry->>'device_id' IS NOT NULL AS numbered,
               COALESCE(
                   (e.entry->>'device_id')::INT,
                   (
                       SELECT d.id
                         FROM device.list d
                        WHERE d.external_id = e.entry->>'shelly_id'
                          AND (
                              e.entry->>'organization_id' IS NULL
                              OR d.organization_id = e.entry->>'organization_id'
                          )
                        LIMIT 1
                   )
               ) AS owner_id
          FROM jsonb_array_elements(p_entries) AS e(entry)
    ),
    owners AS MATERIALIZED (
        SELECT d.id, d.external_id, d.organization_id
          FROM device.list d
         WHERE d.id IN (SELECT x.owner_id FROM entries x)
         ORDER BY d.external_id
           FOR KEY SHARE
    ),
    judged AS MATERIALIZED (
        SELECT x.entry,
               x.numbered,
               o.id AS owner_id,
               COALESCE(
                   o.external_id = x.entry->>'shelly_id'
                   AND (
                       x.entry->>'organization_id' IS NULL
                       OR o.organization_id = x.entry->>'organization_id'
                   ),
                   false
               ) AS owner_matches
          FROM entries x
          LEFT JOIN owners o ON o.id = x.owner_id
    ),
    inserted AS (
        INSERT INTO device.event_log (
            ts, device_id, shelly_id, organization_id,
            component, field, prev, next, kind, source
        )
        SELECT
            COALESCE((j.entry->>'ts')::TIMESTAMPTZ, now()),
            j.owner_id,
            j.entry->>'shelly_id',
            j.entry->>'organization_id',
            j.entry->>'component',
            j.entry->>'field',
            j.entry->'prev',
            j.entry->'next',
            j.entry->>'kind',
            j.entry->>'source'
          FROM judged j
         WHERE j.owner_matches
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inserted),
           count(*) FILTER (WHERE j.numbered AND j.owner_id IS NULL),
           count(*) FILTER (
               WHERE NOT j.owner_matches
                 AND NOT (j.numbered AND j.owner_id IS NULL)
           )
      INTO v_accepted, v_skipped, v_rejected
      FROM judged j;

    IF v_rejected > 0 THEN
        RAISE EXCEPTION 'device event batch contains an unresolved owner'
            USING ERRCODE = '23503';
    END IF;

    accepted := v_accepted;
    skipped := v_skipped;
    RETURN NEXT;
END;
$$;

--------------DOWN
-- Restore the save from 20109 and the event write from 20113.
CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_updated  VARCHAR[];
    v_inserted BIGINT;
BEGIN
    -- Rows are locked in external_id order, so concurrent batches cannot deadlock.
    WITH entry AS MATERIALIZED (
        SELECT * FROM device.fn_snapshot_entries(p_entries)
    ),
    locked AS (
        SELECT target.id, entry.jdoc
        FROM device.list target
        JOIN entry ON entry.external_id = target.external_id
        ORDER BY target.external_id
        FOR UPDATE OF target
    ),
    updated AS (
        UPDATE device.list AS target
           SET jdoc    = COALESCE(locked.jdoc, target.jdoc),
               updated = now()::TIMESTAMPTZ
          FROM locked
         WHERE target.id = locked.id
        RETURNING target.external_id
    )
    SELECT COALESCE(array_agg(updated.external_id), '{}')
      INTO v_updated
      FROM updated;

    WITH inserted AS (
        INSERT INTO device.list AS target (external_id, jdoc)
        SELECT entry.external_id, entry.jdoc
        FROM device.fn_snapshot_entries(p_entries) entry
        WHERE entry.external_id <> ALL (v_updated)
          AND NOT EXISTS (
              SELECT 1
              FROM device.deleted_external_identity deleted
              WHERE deleted.external_id = entry.external_id
          )
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc    = COALESCE(EXCLUDED.jdoc, target.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM inserted;

    RETURN cardinality(v_updated) + v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_event_log_add_batch(p_entries JSONB)
RETURNS TABLE (accepted BIGINT, skipped BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_accepted BIGINT;
    v_skipped BIGINT;
    v_rejected BIGINT;
BEGIN
    WITH entries AS MATERIALIZED (
        SELECT e.entry,
               e.entry->>'device_id' IS NOT NULL AS numbered,
               COALESCE(
                   (e.entry->>'device_id')::INT,
                   (
                       SELECT d.id
                         FROM device.list d
                        WHERE d.external_id = e.entry->>'shelly_id'
                          AND (
                              e.entry->>'organization_id' IS NULL
                              OR d.organization_id = e.entry->>'organization_id'
                          )
                        LIMIT 1
                   )
               ) AS owner_id
          FROM jsonb_array_elements(p_entries) AS e(entry)
    ),
    owners AS MATERIALIZED (
        SELECT d.id, d.external_id, d.organization_id
          FROM device.list d
         WHERE d.id IN (SELECT x.owner_id FROM entries x)
           FOR KEY SHARE
    ),
    judged AS MATERIALIZED (
        SELECT x.entry,
               x.numbered,
               o.id AS owner_id,
               COALESCE(
                   o.external_id = x.entry->>'shelly_id'
                   AND (
                       x.entry->>'organization_id' IS NULL
                       OR o.organization_id = x.entry->>'organization_id'
                   ),
                   false
               ) AS owner_matches
          FROM entries x
          LEFT JOIN owners o ON o.id = x.owner_id
    ),
    inserted AS (
        INSERT INTO device.event_log (
            ts, device_id, shelly_id, organization_id,
            component, field, prev, next, kind, source
        )
        SELECT
            COALESCE((j.entry->>'ts')::TIMESTAMPTZ, now()),
            j.owner_id,
            j.entry->>'shelly_id',
            j.entry->>'organization_id',
            j.entry->>'component',
            j.entry->>'field',
            j.entry->'prev',
            j.entry->'next',
            j.entry->>'kind',
            j.entry->>'source'
          FROM judged j
         WHERE j.owner_matches
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inserted),
           count(*) FILTER (WHERE j.numbered AND j.owner_id IS NULL),
           count(*) FILTER (
               WHERE NOT j.owner_matches
                 AND NOT (j.numbered AND j.owner_id IS NULL)
           )
      INTO v_accepted, v_skipped, v_rejected
      FROM judged j;

    IF v_rejected > 0 THEN
        RAISE EXCEPTION 'device event batch contains an unresolved owner'
            USING ERRCODE = '23503';
    END IF;

    accepted := v_accepted;
    skipped := v_skipped;
    RETURN NEXT;
END;
$$;
