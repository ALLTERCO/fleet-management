--------------UP
ALTER TABLE logging.audit_log
    ADD COLUMN IF NOT EXISTS device_id INT,
    ADD COLUMN IF NOT EXISTS device_ids INT[];

UPDATE logging.audit_log a
   SET device_id = d.id
  FROM device.list d
 WHERE a.device_id IS NULL
   AND a.shelly_id IS NOT NULL
   AND d.external_id = a.shelly_id
   AND (
       a.organization_id IS NULL
       OR d.organization_id = a.organization_id
   );

WITH resolved AS (
    SELECT a.id, a.ts, array_agg(d.id ORDER BY source.ordinality) AS ids
      FROM logging.audit_log a
      CROSS JOIN LATERAL unnest(
          COALESCE(
              a.shelly_ids,
              CASE
                  WHEN a.shelly_id IS NULL THEN ARRAY[]::TEXT[]
                  ELSE ARRAY[a.shelly_id]
              END
          )
      ) WITH ORDINALITY AS source(external_id, ordinality)
      LEFT JOIN device.list d
        ON d.external_id = source.external_id
       AND (
           a.organization_id IS NULL
           OR d.organization_id = a.organization_id
       )
     WHERE a.device_ids IS NULL
     GROUP BY a.id, a.ts
    HAVING bool_and(d.id IS NOT NULL)
)
UPDATE logging.audit_log a
   SET device_ids = resolved.ids
  FROM resolved
 WHERE a.id = resolved.id
   AND a.ts = resolved.ts;

UPDATE logging.audit_log
   SET device_ids = ARRAY[device_id]
 WHERE device_ids IS NULL
   AND device_id IS NOT NULL;

ALTER TABLE logging.audit_log
    ADD CONSTRAINT audit_log_device_fk
        FOREIGN KEY (device_id)
        REFERENCES device.list(id) ON DELETE SET NULL;

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

CREATE TRIGGER audit_log_validate_device_refs
BEFORE INSERT ON logging.audit_log
FOR EACH ROW EXECUTE FUNCTION logging.fn_validate_audit_device_refs();

CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id
    )
    SELECT
        COALESCE((e->>'ts')::TIMESTAMPTZ, now()),
        e->>'event_type',
        e->>'username',
        COALESCE(
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
        ),
        CASE
            WHEN e ? 'device_ids'
                 AND jsonb_typeof(e->'device_ids') = 'array'
            THEN ARRAY(
                SELECT jsonb_array_elements_text(e->'device_ids')::INT
            )
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
                   AND (
                       e->>'organization_id' IS NULL
                       OR d.organization_id = e->>'organization_id'
                   )
                 ORDER BY source.ordinality
            )
        END,
        e->>'shelly_id',
        CASE
            WHEN e ? 'shelly_ids'
                 AND jsonb_typeof(e->'shelly_ids') = 'array'
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

DROP FUNCTION IF EXISTS logging.fn_audit_log_add(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR,
    TEXT[], TIMESTAMPTZ, VARCHAR
);
CREATE FUNCTION logging.fn_audit_log_add(
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
    p_device_ids INT[] DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id
    ) VALUES (
        COALESCE(p_ts, now()),
        p_event_type,
        p_username,
        COALESCE(
            p_device_id,
            (
                SELECT d.id
                  FROM device.list d
                 WHERE d.external_id = p_shelly_id
                   AND (
                       p_organization_id IS NULL
                       OR d.organization_id = p_organization_id
                   )
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
                   AND (
                       p_organization_id IS NULL
                       OR d.organization_id = p_organization_id
                   )
                 ORDER BY source.ordinality
            )
        ),
        p_shelly_id,
        COALESCE(
            p_shelly_ids,
            CASE
                WHEN p_shelly_id IS NULL THEN NULL
                ELSE ARRAY[p_shelly_id]
            END
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

DROP FUNCTION IF EXISTS logging.fn_audit_log_query(
    VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], VARCHAR, VARCHAR, INT, INT
);
CREATE FUNCTION logging.fn_audit_log_query(
    p_organization_id VARCHAR DEFAULT NULL,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_event_types TEXT[] DEFAULT NULL,
    p_username VARCHAR DEFAULT NULL,
    p_shelly_id VARCHAR DEFAULT NULL,
    p_limit INT DEFAULT 10000,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id INT,
    ts TIMESTAMPTZ,
    event_type VARCHAR,
    username VARCHAR,
    device_id INT,
    device_ids INT[],
    shelly_id VARCHAR,
    shelly_ids TEXT[],
    method VARCHAR,
    params JSONB,
    success BOOLEAN,
    error_message TEXT,
    ip_address VARCHAR,
    organization_id VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT a.id, a.ts, a.event_type, a.username, a.device_id, a.device_ids,
           a.shelly_id, a.shelly_ids, a.method, a.params, a.success,
           a.error_message, a.ip_address, a.organization_id
      FROM logging.audit_log a
     WHERE (p_organization_id IS NULL
            OR a.organization_id = p_organization_id)
       AND (p_from IS NULL OR a.ts >= p_from)
       AND (p_to IS NULL OR a.ts <= p_to)
       AND (p_event_types IS NULL OR a.event_type = ANY(p_event_types))
       AND (p_username IS NULL OR a.username = p_username)
       AND (
           p_shelly_id IS NULL
           OR a.device_id = (
               SELECT d.id FROM device.list d
                WHERE d.external_id = p_shelly_id
                  AND (
                      p_organization_id IS NULL
                      OR d.organization_id = p_organization_id
                  )
                LIMIT 1
           )
           OR a.device_ids && ARRAY(
               SELECT d.id FROM device.list d
                WHERE d.external_id = p_shelly_id
                  AND (
                      p_organization_id IS NULL
                      OR d.organization_id = p_organization_id
                  )
           )
           OR a.shelly_id = p_shelly_id
           OR p_shelly_id = ANY(a.shelly_ids)
       )
     ORDER BY a.ts DESC, a.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION logging.fn_reassign_device_ownership(
    p_retained_device_id INT,
    p_temporary_device_id INT
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE logging.audit_log
       SET device_id = CASE
               WHEN device_id = p_temporary_device_id
               THEN p_retained_device_id
               ELSE device_id
           END,
           device_ids = ARRAY(
               SELECT DISTINCT replacement.id
                 FROM unnest(COALESCE(device_ids, ARRAY[]::INT[]))
                      WITH ORDINALITY AS source(id, ordinality)
                 CROSS JOIN LATERAL (
                     SELECT CASE
                         WHEN source.id = p_temporary_device_id
                         THEN p_retained_device_id
                         ELSE source.id
                     END AS id
                 ) replacement
                ORDER BY replacement.id
           )
     WHERE device_id = p_temporary_device_id
        OR device_ids @> ARRAY[p_temporary_device_id];
$$;

--------------DOWN
-- Forward-only logical identity migration.
