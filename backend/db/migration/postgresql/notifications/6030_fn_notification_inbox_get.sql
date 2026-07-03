--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_notification_inbox_get(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                      INTEGER,
    organization_id         VARCHAR,
    user_id                 VARCHAR,
    kind                    VARCHAR,
    state                   VARCHAR,
    alert_id                INTEGER,
    source_subject_type     VARCHAR,
    source_subject_id       VARCHAR,
    title                   VARCHAR,
    message                 TEXT,
    stored_available_actions JSONB,
    created_at              TIMESTAMPTZ,
    read_at                 TIMESTAMPTZ,
    alert_state             VARCHAR,
    alert_rule_kind         VARCHAR,
    alert_silenced_until    TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        i.id,
        i.organization_id,
        i.user_id,
        i.kind,
        i.state,
        i.alert_id,
        i.source_subject_type,
        i.source_subject_id,
        i.title,
        i.message,
        i.available_actions AS stored_available_actions,
        i.created_at,
        i.read_at,
        a.state AS alert_state,
        a.rule_kind AS alert_rule_kind,
        a.silenced_until AS alert_silenced_until
    FROM notifications.inbox_items i
    LEFT JOIN notifications.alert_instances a
           ON a.id = i.alert_id
          AND a.organization_id = i.organization_id
    WHERE i.organization_id = p_organization_id
      AND i.user_id = p_user_id
      AND i.id = p_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_notification_inbox_get;
