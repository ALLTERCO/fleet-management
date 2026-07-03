--------------UP
-- First-class alert evaluation lifecycle states. Pending/no-data/error are
-- stored on alert_instances so preview, lists, badges, and restart recovery
-- read the same durable truth.

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_state_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_state_valid
    CHECK (state IN (
        'pending',
        'active',
        'acknowledged',
        'recovering',
        'cleared_unack',
        'cleared_ack',
        'no_data',
        'evaluation_error',
        'resolved'
    ));

ALTER TABLE notifications.alert_transitions
    DROP CONSTRAINT IF EXISTS alert_transitions_action_valid;
ALTER TABLE notifications.alert_transitions
    ADD CONSTRAINT alert_transitions_action_valid CHECK (action IN (
        'created',
        'pending',
        'triggered',
        'acknowledged',
        'unacknowledged',
        'silenced',
        'unsilenced',
        'recovering',
        'no_data',
        'evaluation_error',
        'cleared_unack',
        'cleared_ack',
        'resolved'
    ));

DROP INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_active;
CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_rule_fingerprint_active
    ON notifications.alert_instances (rule_id, fingerprint)
    WHERE state IN (
        'pending',
        'active',
        'acknowledged',
        'recovering',
        'cleared_unack',
        'cleared_ack',
        'no_data',
        'evaluation_error'
    );

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_upsert(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_severity                  VARCHAR,
    p_subject_type              VARCHAR,
    p_subject_id                VARCHAR,
    p_title                     VARCHAR,
    p_message                   TEXT,
    p_context                   JSONB   DEFAULT '{}'::jsonb,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_dedupe_window_sec         INTEGER DEFAULT 0,
    p_fingerprint_v2            VARCHAR DEFAULT NULL
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
    last_notified_at             TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB,
    was_created                  BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_effective_severity VARCHAR;
    v_window INTERVAL := COALESCE(p_dedupe_window_sec, 0) * INTERVAL '1 second';
    v_previous_state VARCHAR;
    v_was_resolved BOOLEAN;
    v_created BOOLEAN := FALSE;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT ai.id, ai.state, ai.resolved_at IS NOT NULL
    INTO v_id, v_previous_state, v_was_resolved
    FROM notifications.alert_instances ai
    WHERE ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint_v2
      AND (
          ai.resolved_at IS NULL
          OR (v_window > INTERVAL '0' AND ai.resolved_at > NOW() - v_window)
      )
    ORDER BY ai.resolved_at NULLS FIRST
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE notifications.alert_instances ai
        SET state = CASE
                WHEN v_was_resolved
                  OR v_previous_state IN ('pending','recovering','no_data','evaluation_error')
                    THEN 'active'
                ELSE ai.state
            END,
            resolved_at = CASE WHEN v_was_resolved THEN NULL ELSE ai.resolved_at END,
            last_triggered_at = NOW(),
            context = COALESCE(p_context, '{}'::jsonb),
            severity = v_effective_severity,
            title = p_title,
            message = p_message
        WHERE ai.id = v_id;

        PERFORM notifications.fn_alert_transition_append(
            v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
    ELSE
        INSERT INTO notifications.alert_instances (
            organization_id, rule_id, rule_kind, state, severity,
            source_subject_type, source_subject_id,
            title, message, fingerprint, context
        )
        VALUES (
            p_organization_id, p_rule_id, p_rule_kind, 'active',
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, COALESCE(p_context, '{}'::jsonb)
        )
        RETURNING alert_instances.id INTO v_id;
        v_created := TRUE;
    END IF;

    RETURN QUERY
    SELECT
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.last_notified_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context, v_created AS was_created
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_mark_evaluation_state(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_state                     VARCHAR,
    p_severity                  VARCHAR,
    p_subject_type              VARCHAR,
    p_subject_id                VARCHAR,
    p_title                     VARCHAR,
    p_message                   TEXT,
    p_context                   JSONB   DEFAULT '{}'::jsonb,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_fingerprint_v2            VARCHAR DEFAULT NULL
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
    last_notified_at             TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB,
    was_created                  BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_created BOOLEAN := FALSE;
    v_effective_severity VARCHAR;
BEGIN
    IF p_state NOT IN ('pending','recovering','no_data','evaluation_error') THEN
        RAISE EXCEPTION 'Unsupported alert evaluation state: %', p_state
            USING ERRCODE = '22023';
    END IF;

    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT ai.id
      INTO v_id
      FROM notifications.alert_instances ai
     WHERE ai.rule_id = p_rule_id
       AND ai.fingerprint = p_fingerprint_v2
       AND ai.resolved_at IS NULL
     LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE notifications.alert_instances ai
           SET state = p_state,
               severity = v_effective_severity,
               title = p_title,
               message = p_message,
               context = COALESCE(p_context, '{}'::jsonb),
               last_triggered_at = NOW()
         WHERE ai.id = v_id;
    ELSE
        INSERT INTO notifications.alert_instances (
            organization_id, rule_id, rule_kind, state, severity,
            source_subject_type, source_subject_id,
            title, message, fingerprint, context
        )
        VALUES (
            p_organization_id, p_rule_id, p_rule_kind, p_state,
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, COALESCE(p_context, '{}'::jsonb)
        )
        RETURNING alert_instances.id INTO v_id;
        v_created := TRUE;
    END IF;

    PERFORM notifications.fn_alert_transition_append(
        v_id, p_state, NULL, NULL, COALESCE(p_context, '{}'::jsonb)
    );

    RETURN QUERY
    SELECT
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.last_notified_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context, v_created AS was_created
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint_v2  VARCHAR
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
                     AND ai.state IN ('active','acknowledged')
                    THEN CASE WHEN ai.state = 'acknowledged' THEN 'cleared_ack' ELSE 'cleared_unack' END
                ELSE 'resolved'
            END,
            resolved_at = CASE
                WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                     AND ai.state IN ('active','acknowledged')
                    THEN ai.resolved_at
                ELSE NOW()
            END
        WHERE ai.organization_id = p_organization_id
          AND ai.rule_id = p_rule_id
          AND ai.fingerprint = p_fingerprint_v2
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
     WHERE (SELECT count(*) FROM logged) >= 0;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_mark_evaluation_state(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);

UPDATE notifications.alert_instances
   SET state = 'resolved',
       resolved_at = COALESCE(resolved_at, NOW())
 WHERE state IN ('pending','recovering','no_data','evaluation_error');

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_state_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_state_valid
    CHECK (state IN (
        'active',
        'acknowledged',
        'cleared_unack',
        'cleared_ack',
        'resolved'
    ));

DELETE FROM notifications.alert_transitions
 WHERE action IN ('pending','recovering','no_data','evaluation_error');

ALTER TABLE notifications.alert_transitions
    DROP CONSTRAINT IF EXISTS alert_transitions_action_valid;
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

DROP INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_active;
CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_rule_fingerprint_active
    ON notifications.alert_instances (rule_id, fingerprint)
    WHERE state IN ('active', 'acknowledged', 'cleared_unack', 'cleared_ack');

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_upsert(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_severity                  VARCHAR,
    p_subject_type              VARCHAR,
    p_subject_id                VARCHAR,
    p_title                     VARCHAR,
    p_message                   TEXT,
    p_context                   JSONB   DEFAULT '{}'::jsonb,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_dedupe_window_sec         INTEGER DEFAULT 0,
    p_fingerprint_v2            VARCHAR DEFAULT NULL
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
    last_notified_at             TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB,
    was_created                  BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_effective_severity VARCHAR;
    v_window INTERVAL := COALESCE(p_dedupe_window_sec, 0) * INTERVAL '1 second';
    v_was_resolved BOOLEAN;
    v_created BOOLEAN := FALSE;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT ai.id, ai.resolved_at IS NOT NULL
    INTO v_id, v_was_resolved
    FROM notifications.alert_instances ai
    WHERE ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint_v2
      AND (
          ai.resolved_at IS NULL
          OR (v_window > INTERVAL '0' AND ai.resolved_at > NOW() - v_window)
      )
    ORDER BY ai.resolved_at NULLS FIRST
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE notifications.alert_instances ai
        SET state             = CASE WHEN v_was_resolved THEN 'active'
                                     ELSE ai.state END,
            resolved_at       = CASE WHEN v_was_resolved THEN NULL
                                     ELSE ai.resolved_at END,
            last_triggered_at = NOW(),
            context           = p_context,
            severity          = v_effective_severity,
            title             = p_title,
            message           = p_message
        WHERE ai.id = v_id;

        PERFORM notifications.fn_alert_transition_append(
            v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
    ELSE
        INSERT INTO notifications.alert_instances (
            organization_id, rule_id, rule_kind, state, severity,
            source_subject_type, source_subject_id,
            title, message, fingerprint, context
        )
        VALUES (
            p_organization_id, p_rule_id, p_rule_kind, 'active',
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, p_context
        )
        RETURNING alert_instances.id INTO v_id;
        v_created := TRUE;
    END IF;

    RETURN QUERY
    SELECT
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.last_notified_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context, v_created AS was_created
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint_v2  VARCHAR
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
          AND ai.fingerprint = p_fingerprint_v2
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
     WHERE (SELECT count(*) FROM logged) >= 0;
$$;
