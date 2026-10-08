--------------UP
-- LINT-IGNORE: concurrent-index
-- Both indexes below are PARTIAL on agent_key_id / correlation_id, and both
-- columns are created empty in this same migration. The predicate therefore
-- matches zero rows at build time, so the index builds instantly and the write
-- lock it takes is not held for any measurable period. CONCURRENTLY is not an
-- option here regardless: the migration runner wraps each file in one
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one.
--
-- "What did this agent key change?"
--
-- Unanswerable before this. An agent's writes landed as ordinary rpc rows
-- naming only the username — identical to that person's own browser session —
-- while the mcp_tool_call rows that knew which key was used carried no params.
-- After an incident there was no way to join the two.
--
-- agent_key_id  the scoped credential the call arrived on. NULL for a human.
-- correlation_id  shared by every row from one tool call, so the doorway row
--                 and the rpc rows it caused read as one action.
--
-- Named agent_key_id and not credential_id on purpose: the param redactor
-- treats any key containing "credential" as a secret, so a column by that name
-- would be scrubbed to '[redacted]' before it was ever stored.
ALTER TABLE logging.audit_log
    ADD COLUMN IF NOT EXISTS agent_key_id VARCHAR(255);
ALTER TABLE logging.audit_log
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);

-- The forensic query is "everything this key did", newest first. Partial so it
-- costs nothing on the human rows, which are the overwhelming majority.
CREATE INDEX IF NOT EXISTS audit_log_agent_key_idx
    ON logging.audit_log (agent_key_id, ts DESC)
    WHERE agent_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_correlation_idx
    ON logging.audit_log (correlation_id)
    WHERE correlation_id IS NOT NULL;

-- add: two more optional params. Rebuilt on the 7336 body.
-- Dropped first, not replaced: the new params have defaults, so a plain
-- CREATE OR REPLACE would leave the 14-arg version alive beside this one and
-- every call by name would become ambiguous.
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
    p_device_ids INT[] DEFAULT NULL,
    p_actor_user_id VARCHAR DEFAULT NULL,
    p_agent_key_id VARCHAR DEFAULT NULL,
    p_correlation_id VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, actor_user_id, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id,
        agent_key_id, correlation_id
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
        p_organization_id,
        p_agent_key_id,
        p_correlation_id
    )
    RETURNING id;
$$;

-- add_batch: same two fields, read off each entry.
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, actor_user_id, device_id, device_ids,
        shelly_id, shelly_ids, method, params, success,
        error_message, ip_address, organization_id,
        agent_key_id, correlation_id
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
        e->>'organization_id',
        e->>'agent_key_id',
        e->>'correlation_id'
      FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;

-- query: return the two columns and let a caller filter on either.
-- Return type changes, so CREATE OR REPLACE cannot (42P13 fails the whole
-- migration and the backend never boots). Dropped first; the UP block is one
-- transaction. Rebuilt on the 7244 body.
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
    p_offset INT DEFAULT 0,
    p_agent_key_id VARCHAR DEFAULT NULL,
    p_correlation_id VARCHAR DEFAULT NULL
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
    organization_id VARCHAR,
    agent_key_id VARCHAR,
    correlation_id VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT a.id, a.ts, a.event_type, a.username, a.device_id, a.device_ids,
           a.shelly_id, a.shelly_ids, a.method, a.params, a.success,
           a.error_message, a.ip_address, a.organization_id,
           a.agent_key_id, a.correlation_id
      FROM logging.audit_log a
     WHERE (p_organization_id IS NULL
            OR a.organization_id = p_organization_id)
       AND (p_from IS NULL OR a.ts >= p_from)
       AND (p_to IS NULL OR a.ts <= p_to)
       AND (p_event_types IS NULL OR a.event_type = ANY(p_event_types))
       AND (p_username IS NULL OR a.username = p_username)
       AND (p_agent_key_id IS NULL OR a.agent_key_id = p_agent_key_id)
       AND (p_correlation_id IS NULL OR a.correlation_id = p_correlation_id)
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

--------------DOWN
DROP FUNCTION IF EXISTS logging.fn_audit_log_query(
    VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], VARCHAR, VARCHAR, INT, INT,
    VARCHAR, VARCHAR
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

DROP FUNCTION IF EXISTS logging.fn_audit_log_add(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR,
    TEXT[], TIMESTAMPTZ, VARCHAR, INT, INT[], VARCHAR, VARCHAR, VARCHAR
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

DROP INDEX IF EXISTS logging.audit_log_correlation_idx;
DROP INDEX IF EXISTS logging.audit_log_agent_key_idx;
ALTER TABLE logging.audit_log DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE logging.audit_log DROP COLUMN IF EXISTS agent_key_id;
