-- Two live defects in fn_alert_instance_upsert, both exposed by 20032.
--
-- 1. THE WRITE READ STALE VARIABLES. state and resolved_at were derived from
--    v_was_resolved and v_previous_state, captured by an earlier SELECT, and
--    written with WHERE ai.id = v_id and no re-assertion. Interleaving:
--
--      read      state='no_data', resolved_at IS NULL
--      commit    fn_alert_instance_auto_resolve sets state='resolved', resolved_at=NOW()
--      write     state -> 'active'  (v_previous_state was 'no_data')
--                resolved_at -> ai.resolved_at, still set
--
--    That pair violates alert_instances_resolved_at_matches_state (20032) and
--    raises 23514. Before 20032 it corrupted the row silently instead. Both CASE
--    arms now read ai.*, so the pair is consistent whatever committed in between.
--
-- 2. THE LAST COPY OF THE 8-STATE "OPEN". 20032 retired the state list from the
--    index, the ON CONFLICT and mark_evaluation_state, but missed the adopt
--    fallback here. resolved_at IS NULL is now the only definition, everywhere.
--    LIMIT 1 goes with it: the partial UNIQUE index already guarantees one open
--    row per (rule_id, fingerprint), so LIMIT was hiding an impossible case.
--
-- v_changed is untouched. It gates the history append only, and a stale read
-- there costs at most one history row, never a corrupt instance.
--------------UP
SET search_path TO notifications, public;

-- These signatures change their return type. CREATE OR REPLACE cannot do that:
-- PostgreSQL raises 42P13 and the whole migration fails, so the backend never
-- boots. Dropping first is safe because the UP block runs as one transaction.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_upsert(VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR);
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
              AND ai.resolved_at IS NULL;
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
        -- Both CASE arms read ai.*, the row as it is NOW, not v_was_resolved and
        -- v_previous_state from the earlier SELECT. With the stale variables, an
        -- auto_resolve committing in between produced state='active' with
        -- resolved_at still set, which violates
        -- alert_instances_resolved_at_matches_state and raises 23514. Reading the
        -- current row makes the pair consistent by construction: a resolved row is
        -- revived to ('active', NULL), anything else keeps its own resolved_at.
        SET state = CASE
                WHEN ai.resolved_at IS NOT NULL
                  OR ai.state IN ('pending','recovering','no_data','evaluation_error')
                    THEN 'active'
                ELSE ai.state
            END,
            resolved_at = CASE WHEN ai.resolved_at IS NOT NULL THEN NULL ELSE ai.resolved_at END,
            last_triggered_at = NOW(),
            context = COALESCE(p_context, '{}'::jsonb),
            severity = v_effective_severity,
            title = p_title,
            message = p_message
        WHERE ai.id = v_id;

        -- History records material changes only. Latched rows keep their
        -- state on re-fire, so the append is their only trace — keep it.
        IF v_changed
           OR v_previous_state IN ('cleared_unack','cleared_ack') THEN
            PERFORM notifications.fn_alert_transition_append(
                v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
            );
        END IF;
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

        -- History records material changes only. Latched rows keep their
        -- state on re-fire, so the append is their only trace — keep it.
        IF v_changed
           OR v_previous_state IN ('cleared_unack','cleared_ack') THEN
            PERFORM notifications.fn_alert_transition_append(
                v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
            );
        END IF;
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
