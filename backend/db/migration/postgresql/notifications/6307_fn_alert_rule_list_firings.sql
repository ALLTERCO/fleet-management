--------------UP
-- Per-rule firing history. Returns transition rows where the action is
-- 'created' or 'triggered' (i.e. the rule actually fired), joined with
-- the owning alert instance so the caller sees which subject fired.
-- total_count is the same for every row in the page (standard list shape).
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list_firings(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    transition_id       INTEGER,
    alert_id            INTEGER,
    action              VARCHAR,
    fired_at            TIMESTAMPTZ,
    source_subject_type VARCHAR,
    source_subject_id   VARCHAR,
    severity            VARCHAR,
    title               VARCHAR,
    total_count         BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH firings AS (
        SELECT
            t.id           AS transition_id,
            t.alert_id     AS alert_id,
            t.action       AS action,
            t.created_at   AS fired_at,
            i.source_subject_type,
            i.source_subject_id,
            i.severity,
            i.title
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances i ON i.id = t.alert_id
        WHERE i.rule_id = p_rule_id
          AND i.organization_id = p_organization_id
          AND t.action IN ('created', 'triggered')
    ),
    counted AS (
        SELECT COUNT(*)::BIGINT AS total_count FROM firings
    )
    SELECT
        f.transition_id,
        f.alert_id,
        f.action,
        f.fired_at,
        f.source_subject_type,
        f.source_subject_id,
        f.severity,
        f.title,
        c.total_count
    FROM firings f
    CROSS JOIN counted c
    ORDER BY f.fired_at DESC, f.transition_id DESC
    LIMIT p_limit
    OFFSET p_offset;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list_firings(
    VARCHAR, INTEGER, INTEGER, INTEGER
);
