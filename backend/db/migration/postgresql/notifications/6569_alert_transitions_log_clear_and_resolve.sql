-- Log auto-clear and auto-resolve to alert_transitions so the "when did
-- this alert clear/resolve?" question has an answer after the row is
-- re-fired (which nulls resolved_at on alert_instances).

--------------UP

ALTER TABLE notifications.alert_transitions
    DROP CONSTRAINT alert_transitions_action_valid;

ALTER TABLE notifications.alert_transitions
    ADD CONSTRAINT alert_transitions_action_valid CHECK (action IN (
        'created',
        'triggered',
        'acknowledged',
        'unacknowledged',
        'silenced',
        'unsilenced',
        'cleared_unack',
        'cleared_ack',
        'resolved'
    ));

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint     VARCHAR
)
RETURNS TABLE (
    id                           INTEGER,
    organization_id              VARCHAR,
    rule_id                      INTEGER,
    rule_kind                    VARCHAR,
    state                        VARCHAR,
    severity                     VARCHAR,
    source_subject_type          VARCHAR,
    source_subject_id            VARCHAR,
    title                        VARCHAR,
    message                      TEXT,
    fingerprint                  VARCHAR,
    active_since                 TIMESTAMPTZ,
    last_triggered_at            TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB
)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE notifications.alert_instances ai
        SET state = CASE
                WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                    THEN 'cleared_unack'
                ELSE 'resolved'
            END,
            resolved_at = CASE
                WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                    THEN ai.resolved_at
                ELSE NOW()
            END
        WHERE ai.organization_id = p_organization_id
          AND ai.rule_id = p_rule_id
          AND ai.fingerprint = p_fingerprint
          AND ai.resolved_at IS NULL
        RETURNING
            ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
            ai.severity, ai.source_subject_type, ai.source_subject_id,
            ai.title, ai.message, ai.fingerprint, ai.active_since,
            ai.last_triggered_at, ai.acknowledged_at,
            ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
            ai.resolved_at, ai.silenced_until, ai.silence_reason,
            ai.notifications_created_count, ai.delivery_jobs_created_count,
            ai.context
    ),
    logged AS (
        INSERT INTO notifications.alert_transitions (alert_id, action, data)
        SELECT u.id, u.state, '{}'::jsonb FROM updated u
        RETURNING alert_id
    )
    SELECT u.id, u.organization_id, u.rule_id, u.rule_kind, u.state,
           u.severity, u.source_subject_type, u.source_subject_id,
           u.title, u.message, u.fingerprint, u.active_since,
           u.last_triggered_at, u.acknowledged_at,
           u.acknowledged_by_user_id, u.acknowledged_by_display_name,
           u.resolved_at, u.silenced_until, u.silence_reason,
           u.notifications_created_count, u.delivery_jobs_created_count,
           u.context
      FROM updated u
     WHERE (SELECT count(*) FROM logged) >= 0;  -- forces logged CTE to run
$$;

--------------DOWN

-- Strip rows the new actions inserted before re-adding the narrower check;
-- otherwise ALTER TABLE ADD CONSTRAINT rejects them.
DELETE FROM notifications.alert_transitions
 WHERE action IN ('cleared_unack', 'cleared_ack');

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint     VARCHAR
)
RETURNS TABLE (
    id                           INTEGER,
    organization_id              VARCHAR,
    rule_id                      INTEGER,
    rule_kind                    VARCHAR,
    state                        VARCHAR,
    severity                     VARCHAR,
    source_subject_type          VARCHAR,
    source_subject_id            VARCHAR,
    title                        VARCHAR,
    message                      TEXT,
    fingerprint                  VARCHAR,
    active_since                 TIMESTAMPTZ,
    last_triggered_at            TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB
)
LANGUAGE sql
AS $$
    UPDATE notifications.alert_instances ai
    SET state = CASE
            WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                THEN 'cleared_unack'
            ELSE 'resolved'
        END,
        resolved_at = CASE
            WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                THEN ai.resolved_at
            ELSE NOW()
        END
    WHERE ai.organization_id = p_organization_id
      AND ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint
      AND ai.resolved_at IS NULL
    RETURNING
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context;
$$;

ALTER TABLE notifications.alert_transitions
    DROP CONSTRAINT alert_transitions_action_valid;

ALTER TABLE notifications.alert_transitions
    ADD CONSTRAINT alert_transitions_action_valid CHECK (action IN (
        'created',
        'triggered',
        'acknowledged',
        'unacknowledged',
        'silenced',
        'unsilenced',
        'resolved'
    ));
