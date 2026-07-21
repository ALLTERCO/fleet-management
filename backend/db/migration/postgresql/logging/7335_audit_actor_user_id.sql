--------------UP
-- Stable Zitadel subject for audit ownership. Username remains a snapshot.
-- LINT-IGNORE: concurrent-index -- Timescale hypertables reject CONCURRENTLY.
ALTER TABLE logging.audit_log
    ADD COLUMN IF NOT EXISTS actor_user_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id
    ON logging.audit_log (actor_user_id, ts DESC)
    WHERE actor_user_id IS NOT NULL;

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

DROP FUNCTION IF EXISTS logging.fn_audit_log_add(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR,
    TEXT[], TIMESTAMPTZ, VARCHAR, INT, INT[]
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

--------------DOWN
DROP FUNCTION IF EXISTS logging.fn_audit_log_add(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR,
    TEXT[], TIMESTAMPTZ, VARCHAR, INT, INT[], VARCHAR
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
        COALESCE(p_ts, now()), p_event_type, p_username,
        COALESCE(p_device_id, (
            SELECT d.id FROM device.list d
             WHERE d.external_id = p_shelly_id
               AND (p_organization_id IS NULL OR d.organization_id = p_organization_id)
             LIMIT 1
        )),
        COALESCE(p_device_ids, ARRAY(
            SELECT d.id
              FROM unnest(COALESCE(
                  p_shelly_ids,
                  CASE WHEN p_shelly_id IS NULL THEN ARRAY[]::TEXT[]
                       ELSE ARRAY[p_shelly_id] END
              )) WITH ORDINALITY AS source(external_id, ordinality)
              JOIN device.list d ON d.external_id = source.external_id
               AND (p_organization_id IS NULL OR d.organization_id = p_organization_id)
             ORDER BY source.ordinality
        )),
        p_shelly_id,
        COALESCE(p_shelly_ids,
            CASE WHEN p_shelly_id IS NULL THEN NULL ELSE ARRAY[p_shelly_id] END),
        p_method, COALESCE(p_params, '{}'::JSONB), p_success,
        p_error_message, p_ip_address, p_organization_id
    )
    RETURNING id;
$$;

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
        e->>'event_type', e->>'username',
        COALESCE((e->>'device_id')::INT, (
            SELECT d.id FROM device.list d
             WHERE d.external_id = e->>'shelly_id'
               AND (e->>'organization_id' IS NULL
                    OR d.organization_id = e->>'organization_id')
             LIMIT 1
        )),
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
                  JOIN device.list d ON d.external_id = source.external_id
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
        e->>'method', COALESCE(NULLIF(e->'params', 'null'::JSONB), '{}'::JSONB),
        COALESCE((e->>'success')::BOOLEAN, TRUE), e->>'error_message',
        e->>'ip_address', e->>'organization_id'
      FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;

DROP INDEX IF EXISTS logging.idx_audit_log_actor_user_id;
ALTER TABLE logging.audit_log DROP COLUMN IF EXISTS actor_user_id;
