--------------UP
-- Every org rerun re-marked/re-upserted unchanged rows and the engine emitted
-- Alert.Created/Updated for each — a WS storm on device-admission bursts.
-- Fix: report `changed` (first fire, state transition, or severity/title/
-- message drift) so callers emit only on material change. last_triggered_at
-- keeps updating on every call; it is bookkeeping, not a material change.
-- Numbered 6936: lands right after 6935 (the current definitions).
-- RETURNS TABLE gained a column, so DROP before CREATE.

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_upsert(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR
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
    was_created                  BOOLEAN,
    changed                      BOOLEAN
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
    v_prev_severity VARCHAR;
    v_prev_title VARCHAR;
    v_prev_message TEXT;
    v_changed BOOLEAN;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT ai.id, ai.state, ai.resolved_at IS NOT NULL,
           ai.severity, ai.title, ai.message
    INTO v_id, v_previous_state, v_was_resolved,
         v_prev_severity, v_prev_title, v_prev_message
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
            SELECT ai.id, ai.state, ai.resolved_at IS NOT NULL,
                   ai.severity, ai.title, ai.message
            INTO v_id, v_previous_state, v_was_resolved,
                 v_prev_severity, v_prev_title, v_prev_message
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

    -- Material change: first fire, (re)activation transition, or a
    -- severity/title/message drift (values live in title/message).
    v_changed := v_created
        OR COALESCE(v_was_resolved, FALSE)
        OR v_previous_state IN ('pending','recovering','no_data','evaluation_error')
        OR v_effective_severity IS DISTINCT FROM v_prev_severity
        OR p_title IS DISTINCT FROM v_prev_title
        OR p_message IS DISTINCT FROM v_prev_message;

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
        ai.context, v_created AS was_created,
        COALESCE(v_changed, TRUE) AS changed
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_mark_evaluation_state(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);

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
    was_created                  BOOLEAN,
    changed                      BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_created BOOLEAN := FALSE;
    v_effective_severity VARCHAR;
    v_prev_state VARCHAR;
    v_prev_severity VARCHAR;
    v_prev_title VARCHAR;
    v_prev_message TEXT;
    v_changed BOOLEAN;
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

    SELECT ai.id, ai.state, ai.severity, ai.title, ai.message
      INTO v_id, v_prev_state, v_prev_severity, v_prev_title, v_prev_message
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
            SELECT ai.id, ai.state, ai.severity, ai.title, ai.message
              INTO v_id, v_prev_state, v_prev_severity,
                   v_prev_title, v_prev_message
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

    -- Material change: first mark, state transition, or content drift.
    v_changed := v_created
        OR p_state IS DISTINCT FROM v_prev_state
        OR v_effective_severity IS DISTINCT FROM v_prev_severity
        OR p_title IS DISTINCT FROM v_prev_title
        OR p_message IS DISTINCT FROM v_prev_message;

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
        ai.context, v_created AS was_created,
        COALESCE(v_changed, TRUE) AS changed
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

--------------DOWN
-- Restore the 6935 definitions (race-safe, no changed column).

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_upsert(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR
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

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_mark_evaluation_state(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);

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
