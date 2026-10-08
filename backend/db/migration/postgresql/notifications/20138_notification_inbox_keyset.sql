--------------UP
SET search_path TO public;

-- inbox_items_by_user puts state before created_at, so a page without a
-- state filter sorted every matching row (EXPLAIN on a seeded test DB). This
-- index serves the newest-first order and the keyset bound directly.
CREATE INDEX IF NOT EXISTS inbox_items_by_user_created
    ON notifications.inbox_items (organization_id, user_id, created_at DESC, id DESC);

-- Reads the inbox items a burst of Notification.Created events named, in one
-- call. Only the caller's own items: the recipient is the authorization.
CREATE OR REPLACE FUNCTION notifications.fn_notification_inbox_get_many(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR,
    p_ids             INTEGER[]
)
RETURNS TABLE (
    id                       INTEGER,
    organization_id          VARCHAR,
    user_id                  VARCHAR,
    kind                     VARCHAR,
    state                    VARCHAR,
    alert_id                 INTEGER,
    source_subject_type      VARCHAR,
    source_subject_id        VARCHAR,
    title                    VARCHAR,
    message                  TEXT,
    stored_available_actions JSONB,
    created_at               TIMESTAMPTZ,
    read_at                  TIMESTAMPTZ,
    alert_state              VARCHAR,
    alert_rule_kind          VARCHAR,
    alert_silenced_until     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT i.id, i.organization_id, i.user_id, i.kind, i.state, i.alert_id,
           i.source_subject_type, i.source_subject_id, i.title, i.message,
           i.available_actions, i.created_at, i.read_at,
           a.state, a.rule_kind, a.silenced_until
      FROM notifications.inbox_items i
      LEFT JOIN notifications.alert_instances a
             ON a.id = i.alert_id
            AND a.organization_id = i.organization_id
     WHERE i.organization_id = p_organization_id
       AND i.user_id = p_user_id
       AND i.id = ANY(p_ids)
     ORDER BY i.created_at DESC, i.id DESC;
$$;

-- A new function, so fn_notification_inbox_list stays for the previous
-- release during a rolling deploy and its own migration keeps owning it.
-- p_after: keyset position [created_at as microsecond text, id]; the <= bound
-- lets an index start at the cursor. p_skip_total: a cursor page does not
-- count every match.
CREATE OR REPLACE FUNCTION notifications.fn_notification_inbox_page(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR,
    p_state           VARCHAR DEFAULT NULL,
    p_kind            VARCHAR DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_after           JSONB DEFAULT NULL,
    p_skip_total      BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
    total_count              BIGINT,
    id                       INTEGER,
    organization_id          VARCHAR,
    user_id                  VARCHAR,
    kind                     VARCHAR,
    state                    VARCHAR,
    alert_id                 INTEGER,
    source_subject_type      VARCHAR,
    source_subject_id        VARCHAR,
    title                    VARCHAR,
    message                  TEXT,
    stored_available_actions JSONB,
    created_at               TIMESTAMPTZ,
    read_at                  TIMESTAMPTZ,
    alert_state              VARCHAR,
    alert_rule_kind          VARCHAR,
    alert_silenced_until     TIMESTAMPTZ,
    cursor_key               JSONB
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS NOT MATERIALIZED (
        SELECT *
          FROM notifications.inbox_items i
         WHERE i.organization_id = p_organization_id
           AND i.user_id = p_user_id
           AND (p_state IS NULL OR i.state = p_state)
           AND (p_kind IS NULL OR i.kind = p_kind)
           AND (
               p_query IS NULL
               OR i.title ILIKE '%' || p_query || '%'
               OR i.message ILIKE '%' || p_query || '%'
           )
    ),
    total AS (
        SELECT count(*) AS c FROM filtered WHERE p_skip_total IS NOT TRUE
    )
    SELECT CASE WHEN p_skip_total THEN NULL ELSE total.c END,
           i.id, i.organization_id, i.user_id, i.kind, i.state, i.alert_id,
           i.source_subject_type, i.source_subject_id, i.title, i.message,
           i.available_actions, i.created_at, i.read_at,
           a.state, a.rule_kind, a.silenced_until,
           CASE WHEN i.id IS NOT NULL THEN jsonb_build_array(
               to_char(i.created_at AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               i.id) END
      FROM total
      LEFT JOIN LATERAL (
          SELECT *
            FROM filtered f
           WHERE p_after IS NULL
              OR (f.created_at <= (p_after->>0)::TIMESTAMPTZ
                  AND (f.created_at, f.id)
                      < ((p_after->>0)::TIMESTAMPTZ, (p_after->>1)::INTEGER))
           ORDER BY f.created_at DESC, f.id DESC
           LIMIT p_limit OFFSET p_offset
      ) i ON TRUE
      LEFT JOIN notifications.alert_instances a
             ON a.id = i.alert_id
            AND a.organization_id = i.organization_id
     ORDER BY i.created_at DESC, i.id DESC;
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS notifications.fn_notification_inbox_page(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS notifications.fn_notification_inbox_get_many(VARCHAR, VARCHAR, INTEGER[]);
DROP INDEX IF EXISTS notifications.inbox_items_by_user_created;
