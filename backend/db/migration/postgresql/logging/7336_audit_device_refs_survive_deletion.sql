--------------UP
-- Audit rows must survive device deletion. The audit queue flushes
-- asynchronously, so a row about a just-deleted device (including the
-- device.delete entry itself) can reach the database after the device row
-- is gone. The 7244 validation trigger raised 'audit device owner is
-- unresolved' for that race and the writer dropped the entry after its
-- retries — losing audit history.
--
-- Model (same as actor_user_id vs username in 7335): shelly_id/shelly_ids
-- are the durable snapshot; device_id/device_ids are best-effort pointers.
-- The trigger is the single resolver:
--   * missing device       -> NULL pointer, row kept (deletion lifecycle)
--   * live device in the wrong org or a mismatched pair -> still an error
--     (tenant integrity, fail loud)
-- fn_audit_log_add / fn_audit_log_add_batch stop pre-resolving: their
-- inner joins shortened device_ids when a device was gone, which the
-- trigger then rejected. They now insert what the caller supplied.

CREATE OR REPLACE FUNCTION logging.fn_validate_audit_device_refs()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_expected INT;
    v_pos INT;
BEGIN
    IF NEW.shelly_id IS NOT NULL AND NEW.device_id IS NULL THEN
        SELECT d.id INTO NEW.device_id
          FROM device.list d
         WHERE d.external_id = NEW.shelly_id
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           );
        -- Unresolved is legitimate: the device may already be deleted.
    END IF;

    IF NEW.device_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM device.list d
         WHERE d.id = NEW.device_id
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           )
           AND (
               NEW.shelly_id IS NULL
               OR d.external_id = NEW.shelly_id
           )
    ) THEN
        IF EXISTS (SELECT 1 FROM device.list d WHERE d.id = NEW.device_id) THEN
            RAISE EXCEPTION 'audit device owner is invalid'
                USING ERRCODE = '23503';
        END IF;
        NEW.device_id := NULL;
    END IF;

    v_expected := cardinality(NEW.shelly_ids);
    IF v_expected > 0 AND NEW.device_ids IS NULL THEN
        -- LEFT JOIN keeps one slot per shelly id so the arrays stay
        -- positionally paired; unresolved slots are NULL.
        SELECT array_agg(d.id ORDER BY source.ordinality)
          INTO NEW.device_ids
          FROM unnest(NEW.shelly_ids)
               WITH ORDINALITY AS source(external_id, ordinality)
          LEFT JOIN device.list d
            ON d.external_id = source.external_id
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           );
    END IF;

    IF v_expected > 0
       AND cardinality(NEW.device_ids) IS DISTINCT FROM v_expected
    THEN
        -- Only reachable for caller-supplied arrays that do not pair up.
        RAISE EXCEPTION 'audit device owners are unresolved'
            USING ERRCODE = '23503';
    END IF;

    IF cardinality(NEW.device_ids) > 0 THEN
        FOR v_pos IN 1..cardinality(NEW.device_ids) LOOP
            IF NEW.device_ids[v_pos] IS NULL THEN
                CONTINUE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM device.list d
                 WHERE d.id = NEW.device_ids[v_pos]
                   AND (
                       NEW.organization_id IS NULL
                       OR d.organization_id = NEW.organization_id
                   )
                   AND (
                       NEW.shelly_ids IS NULL
                       OR d.external_id = NEW.shelly_ids[v_pos]
                   )
            ) THEN
                IF EXISTS (
                    SELECT 1 FROM device.list d
                     WHERE d.id = NEW.device_ids[v_pos]
                ) THEN
                    RAISE EXCEPTION 'audit device owners are invalid'
                        USING ERRCODE = '23503';
                END IF;
                NEW.device_ids[v_pos] := NULL;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, actor_user_id, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id
    )
    SELECT
        COALESCE((e->>'ts')::TIMESTAMPTZ, now()),
        e->>'event_type',
        e->>'username',
        e->>'actor_user_id',
        (e->>'device_id')::INT,
        CASE
            WHEN e ? 'device_ids' AND jsonb_typeof(e->'device_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(e->'device_ids')::INT)
            ELSE NULL
        END,
        e->>'shelly_id',
        CASE
            WHEN e ? 'shelly_ids' AND jsonb_typeof(e->'shelly_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(e->'shelly_ids'))
            WHEN e->>'shelly_id' IS NULL THEN NULL
            ELSE ARRAY[e->>'shelly_id']
        END,
        e->>'method',
        COALESCE(NULLIF(e->'params', 'null'::JSONB), '{}'::JSONB),
        COALESCE((e->>'success')::BOOLEAN, TRUE),
        e->>'error_message',
        e->>'ip_address',
        e->>'organization_id'
      FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;

CREATE OR REPLACE FUNCTION logging.fn_audit_log_add(
    p_event_type VARCHAR,
    p_username VARCHAR DEFAULT NULL,
    p_shelly_id VARCHAR DEFAULT NULL,
    p_method VARCHAR DEFAULT NULL,
    p_params JSONB DEFAULT NULL,
    p_success BOOLEAN DEFAULT TRUE,
    p_error_message TEXT DEFAULT NULL,
    p_ip_address VARCHAR DEFAULT NULL,
    p_shelly_ids TEXT[] DEFAULT NULL,
    p_ts TIMESTAMPTZ DEFAULT NULL,
    p_organization_id VARCHAR DEFAULT NULL,
    p_device_id INT DEFAULT NULL,
    p_device_ids INT[] DEFAULT NULL,
    p_actor_user_id VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, actor_user_id, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id
    ) VALUES (
        COALESCE(p_ts, now()),
        p_event_type,
        p_username,
        p_actor_user_id,
        p_device_id,
        p_device_ids,
        p_shelly_id,
        COALESCE(
            p_shelly_ids,
            CASE WHEN p_shelly_id IS NULL THEN NULL ELSE ARRAY[p_shelly_id] END
        ),
        p_method,
        COALESCE(p_params, '{}'::JSONB),
        p_success,
        p_error_message,
        p_ip_address,
        p_organization_id
    )
    RETURNING id;
$$;

--------------DOWN
-- Restore the strict 7244 trigger and the pre-resolving 7335 writers for a
-- single-step rollback.
CREATE OR REPLACE FUNCTION logging.fn_validate_audit_device_refs()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_expected INT;
BEGIN
    IF NEW.shelly_id IS NOT NULL AND NEW.device_id IS NULL THEN
        SELECT d.id INTO NEW.device_id
          FROM device.list d
         WHERE d.external_id = NEW.shelly_id
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           );
        IF NEW.device_id IS NULL THEN
            RAISE EXCEPTION 'audit device owner is unresolved'
                USING ERRCODE = '23503';
        END IF;
    END IF;

    IF NEW.device_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM device.list d
         WHERE d.id = NEW.device_id
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           )
           AND (
               NEW.shelly_id IS NULL
               OR d.external_id = NEW.shelly_id
           )
    ) THEN
        RAISE EXCEPTION 'audit device owner is invalid'
            USING ERRCODE = '23503';
    END IF;

    v_expected := cardinality(NEW.shelly_ids);
    IF v_expected > 0 AND NEW.device_ids IS NULL THEN
        SELECT array_agg(d.id ORDER BY source.ordinality)
          INTO NEW.device_ids
          FROM unnest(NEW.shelly_ids)
               WITH ORDINALITY AS source(external_id, ordinality)
          JOIN device.list d
            ON d.external_id = source.external_id
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           );
    END IF;

    IF v_expected > 0
       AND cardinality(NEW.device_ids) IS DISTINCT FROM v_expected
    THEN
        RAISE EXCEPTION 'audit device owners are unresolved'
            USING ERRCODE = '23503';
    END IF;

    IF cardinality(NEW.device_ids) > 0 AND EXISTS (
        SELECT 1
          FROM generate_subscripts(NEW.device_ids, 1) position
          LEFT JOIN device.list d
            ON d.id = NEW.device_ids[position]
           AND (
               NEW.organization_id IS NULL
               OR d.organization_id = NEW.organization_id
           )
           AND (
               NEW.shelly_ids IS NULL
               OR d.external_id = NEW.shelly_ids[position]
           )
         WHERE d.id IS NULL
    ) THEN
        RAISE EXCEPTION 'audit device owners are invalid'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, actor_user_id, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id
    )
    SELECT
        COALESCE((e->>'ts')::TIMESTAMPTZ, now()),
        e->>'event_type',
        e->>'username',
        e->>'actor_user_id',
        COALESCE(
            (e->>'device_id')::INT,
            (
                SELECT d.id
                  FROM device.list d
                 WHERE d.external_id = e->>'shelly_id'
                   AND (e->>'organization_id' IS NULL
                        OR d.organization_id = e->>'organization_id')
                 LIMIT 1
            )
        ),
        CASE
            WHEN e ? 'device_ids' AND jsonb_typeof(e->'device_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(e->'device_ids')::INT)
            ELSE ARRAY(
                SELECT d.id
                  FROM jsonb_array_elements_text(
                      CASE
                          WHEN e ? 'shelly_ids'
                               AND jsonb_typeof(e->'shelly_ids') = 'array'
                          THEN e->'shelly_ids'
                          WHEN e->>'shelly_id' IS NOT NULL
                          THEN jsonb_build_array(e->>'shelly_id')
                          ELSE '[]'::JSONB
                      END
                  ) WITH ORDINALITY AS source(external_id, ordinality)
                  JOIN device.list d
                    ON d.external_id = source.external_id
                   AND (e->>'organization_id' IS NULL
                        OR d.organization_id = e->>'organization_id')
                 ORDER BY source.ordinality
            )
        END,
        e->>'shelly_id',
        CASE
            WHEN e ? 'shelly_ids' AND jsonb_typeof(e->'shelly_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(e->'shelly_ids'))
            WHEN e->>'shelly_id' IS NULL THEN NULL
            ELSE ARRAY[e->>'shelly_id']
        END,
        e->>'method',
        COALESCE(NULLIF(e->'params', 'null'::JSONB), '{}'::JSONB),
        COALESCE((e->>'success')::BOOLEAN, TRUE),
        e->>'error_message',
        e->>'ip_address',
        e->>'organization_id'
      FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;

CREATE OR REPLACE FUNCTION logging.fn_audit_log_add(
    p_event_type VARCHAR,
    p_username VARCHAR DEFAULT NULL,
    p_shelly_id VARCHAR DEFAULT NULL,
    p_method VARCHAR DEFAULT NULL,
    p_params JSONB DEFAULT NULL,
    p_success BOOLEAN DEFAULT TRUE,
    p_error_message TEXT DEFAULT NULL,
    p_ip_address VARCHAR DEFAULT NULL,
    p_shelly_ids TEXT[] DEFAULT NULL,
    p_ts TIMESTAMPTZ DEFAULT NULL,
    p_organization_id VARCHAR DEFAULT NULL,
    p_device_id INT DEFAULT NULL,
    p_device_ids INT[] DEFAULT NULL,
    p_actor_user_id VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, actor_user_id, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id
    ) VALUES (
        COALESCE(p_ts, now()),
        p_event_type,
        p_username,
        p_actor_user_id,
        COALESCE(
            p_device_id,
            (
                SELECT d.id
                  FROM device.list d
                 WHERE d.external_id = p_shelly_id
                   AND (p_organization_id IS NULL
                        OR d.organization_id = p_organization_id)
                 LIMIT 1
            )
        ),
        COALESCE(
            p_device_ids,
            ARRAY(
                SELECT d.id
                  FROM unnest(
                      COALESCE(
                          p_shelly_ids,
                          CASE
                              WHEN p_shelly_id IS NULL THEN ARRAY[]::TEXT[]
                              ELSE ARRAY[p_shelly_id]
                          END
                      )
                  ) WITH ORDINALITY AS source(external_id, ordinality)
                  JOIN device.list d
                    ON d.external_id = source.external_id
                   AND (p_organization_id IS NULL
                        OR d.organization_id = p_organization_id)
                 ORDER BY source.ordinality
            )
        ),
        p_shelly_id,
        COALESCE(
            p_shelly_ids,
            CASE WHEN p_shelly_id IS NULL THEN NULL ELSE ARRAY[p_shelly_id] END
        ),
        p_method,
        COALESCE(p_params, '{}'::JSONB),
        p_success,
        p_error_message,
        p_ip_address,
        p_organization_id
    )
    RETURNING id;
$$;
