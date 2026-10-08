--------------UP
-- One batch carries events of many devices. When one device was purged after
-- its events were queued, the whole batch failed with 23503 and the drainer
-- dropped every other device's events with it. A row whose numbered owner no
-- longer exists is now skipped and counted. The identity fence is unchanged:
-- an owner that exists but does not match the row still rejects the batch.
--
-- Owners are locked FOR KEY SHARE before the insert. A purge that commits
-- first removes the owner before the lock, so its rows are skipped. A purge
-- that comes later waits for this insert, and its ON DELETE SET NULL then
-- detaches the new rows like every older row of that device.
DROP FUNCTION IF EXISTS device.fn_event_log_add_batch(JSONB);

CREATE FUNCTION device.fn_event_log_add_batch(p_entries JSONB)
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

--------------DOWN
-- Restore the all-or-nothing version from 7242.
DROP FUNCTION IF EXISTS device.fn_event_log_add_batch(JSONB);

CREATE FUNCTION device.fn_event_log_add_batch(p_entries JSONB)
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
