--------------UP
-- Concurrent evaluations (scope_changed rerun vs event pass) both passed the
-- SELECT-then-INSERT window and the second INSERT hit the partial unique index
-- alert_instances_rule_fingerprint_active, failing the whole evaluation run.
-- Fix: arbiter the INSERT on that index; the loser adopts the winner's live
-- row and takes the normal re-trigger UPDATE path.
-- Numbered 6935: the runner sorts numerically, so this lands right after 6934
-- (the current definitions); nothing in 20xxx redefines these functions.

-- Own scope: plpgsql cannot qualify ON CONFLICT target columns, and the
-- callers' RETURNS TABLE shadows rule_id/fingerprint/state.
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_insert_live(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_rule_kind       VARCHAR,
    p_state           VARCHAR,
    p_severity        VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_title           VARCHAR,
    p_message         TEXT,
    p_fingerprint     VARCHAR,
    p_context         JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    -- NULL result = lost the race to a concurrent live insert.
    INSERT INTO notifications.alert_instances (
        organization_id, rule_id, rule_kind, state, severity,
        source_subject_type, source_subject_id,
        title, message, fingerprint, context
    )
    VALUES (
        p_organization_id, p_rule_id, p_rule_kind, p_state,
        p_severity, p_subject_type, p_subject_id,
        p_title, p_message, p_fingerprint, COALESCE(p_context, '{}'::jsonb)
    )
    ON CONFLICT (rule_id, fingerprint)
        WHERE state IN (
            'pending',
            'active',
            'acknowledged',
            'recovering',
            'cleared_unack',
            'cleared_ack',
            'no_data',
            'evaluation_error'
        )
        DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

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

    IF v_id IS NULL THEN
        v_id := notifications.fn_alert_instance_insert_live(
            p_organization_id, p_rule_id, p_rule_kind, 'active',
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, p_context
        );

        IF v_id IS NOT NULL THEN
            v_created := TRUE;
        ELSE
            -- Lost the insert race: adopt the winner's live row.
            SELECT ai.id, ai.state, ai.resolved_at IS NOT NULL
            INTO v_id, v_previous_state, v_was_resolved
            FROM notifications.alert_instances ai
            WHERE ai.rule_id = p_rule_id
              AND ai.fingerprint = p_fingerprint_v2
              AND ai.state IN (
                  'pending',
                  'active',
                  'acknowledged',
                  'recovering',
                  'cleared_unack',
                  'cleared_ack',
                  'no_data',
                  'evaluation_error'
              )
            LIMIT 1;
        END IF;
    END IF;

    IF v_id IS NOT NULL AND NOT v_created THEN
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

    IF v_id IS NULL THEN
        v_id := notifications.fn_alert_instance_insert_live(
            p_organization_id, p_rule_id, p_rule_kind, p_state,
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, p_context
        );

        IF v_id IS NOT NULL THEN
            v_created := TRUE;
        ELSE
            -- Lost the insert race: adopt the winner's live row.
            SELECT ai.id
              INTO v_id
              FROM notifications.alert_instances ai
             WHERE ai.rule_id = p_rule_id
               AND ai.fingerprint = p_fingerprint_v2
               AND ai.state IN (
                   'pending',
                   'active',
                   'acknowledged',
                   'recovering',
                   'cleared_unack',
                   'cleared_ack',
                   'no_data',
                   'evaluation_error'
               )
             LIMIT 1;
        END IF;
    END IF;

    IF v_id IS NOT NULL AND NOT v_created THEN
        UPDATE notifications.alert_instances ai
           SET state = p_state,
               severity = v_effective_severity,
               title = p_title,
               message = p_message,
               context = COALESCE(p_context, '{}'::jsonb),
               last_triggered_at = NOW()
         WHERE ai.id = v_id;
    END IF;

    IF v_id IS NOT NULL THEN
        PERFORM notifications.fn_alert_transition_append(
            v_id, p_state, NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
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

--------------DOWN
-- Restore the 6934 definitions (SELECT-then-INSERT, no arbiter).

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_insert_live(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, TEXT, VARCHAR, JSONB
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
