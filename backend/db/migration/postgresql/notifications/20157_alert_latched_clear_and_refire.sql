-- A latched smoke or flood alarm: one clear, and a re-fire that is a new alarm.
--
-- Smoke and flood do not resolve when their condition ends. They go to
-- 'cleared_unack' (or 'cleared_ack' when acknowledged) with resolved_at NULL,
-- so a person still has to look. 20104 is the live definition of both
-- functions changed here.
--
-- fn_alert_instance_upsert, the re-fire. 20104 kept a cleared row's state, so
-- `changed` was FALSE and, with cooldown 0, nobody was told the alarm came
-- back. A cleared alarm is not firing (ALERT_STATES_ALREADY_FIRING in
-- src/modules/alert/states.ts), so a re-fire now moves it to 'active', reports
-- one change and clears the acknowledgement as the 'unacknowledged' action does
-- (6520): an acknowledgement settles one event, not the next alarm, and
-- escalation rings only while the state is 'active'. The history keeps the old
-- acknowledgement. Later messages on the live row are unchanged, as before.
--
-- fn_alert_instance_auto_resolve, the clear. A second clear on a row that is
-- already 'cleared_unack'/'cleared_ack' fell through to 'resolved' and closed
-- an alarm nobody had seen. It is now a no-op: no write, no history row, no
-- returned row, so the engine sends nothing.
--
-- `active_since` is not reset: it is documented as the first activation.
--
-- Decision: docs/internal/decisions/alert-change-is-state-not-value.md.
--------------UP
SET search_path TO notifications, public;

-- Paired drop, as in 20104: the older 6039 sorts after this file by name.
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
    v_changed BOOLEAN;
    v_was_cleared BOOLEAN;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    -- Selection only: the values are reread under the lock below.
    SELECT ai.id
    INTO v_id
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
            SELECT ai.id
            INTO v_id
            FROM notifications.alert_instances ai
            WHERE ai.rule_id = p_rule_id
              AND ai.fingerprint = p_fingerprint_v2
              AND ai.resolved_at IS NULL;
        END IF;
    END IF;

    IF v_created THEN
        v_changed := TRUE;
        -- The open is a firing too. Rule.ListFirings and the rule's last-fired
        -- time read 'triggered' rows, and a steady alert has no later fire.
        PERFORM notifications.fn_alert_transition_append(
            v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
    ELSIF v_id IS NOT NULL THEN
        -- Lock, then read. A clear committing between the scan and here blocks
        -- on this lock, so the decision below sees the row the UPDATE writes.
        SELECT ai.state, ai.resolved_at IS NOT NULL,
               ai.severity, ai.title
        INTO v_previous_state, v_was_resolved,
             v_prev_severity, v_prev_title
        FROM notifications.alert_instances ai
        WHERE ai.id = v_id
        FOR NO KEY UPDATE;

        -- A cleared alarm is not firing, so firing again re-enters the state:
        -- a new alarm, exactly as `ALERT_STATES_ALREADY_FIRING` reads it.
        v_was_cleared := v_previous_state IN ('cleared_unack','cleared_ack');
        -- A change is a (re)activation, a severity or a title. The message and
        -- context carry the reading, which moves with every status message.
        v_changed := COALESCE(v_was_resolved, FALSE)
            OR v_was_cleared
            OR v_previous_state IN ('pending','recovering','no_data','evaluation_error')
            OR v_effective_severity IS DISTINCT FROM v_prev_severity
            OR p_title IS DISTINCT FROM v_prev_title;

        IF v_changed THEN
            UPDATE notifications.alert_instances ai
            -- Both CASE arms read ai.*, which the lock above pins to the row
            -- the decision used.
            SET state = CASE
                    WHEN ai.resolved_at IS NOT NULL
                      OR v_was_cleared
                      OR ai.state IN ('pending','recovering','no_data','evaluation_error')
                        THEN 'active'
                    ELSE ai.state
                END,
                -- The acknowledgement was of the clear, not of this alarm, and
                -- escalation rings only while the state is 'active'.
                acknowledged_at = CASE WHEN v_was_cleared THEN NULL ELSE ai.acknowledged_at END,
                acknowledged_by_user_id = CASE WHEN v_was_cleared THEN NULL ELSE ai.acknowledged_by_user_id END,
                acknowledged_by_display_name = CASE WHEN v_was_cleared THEN NULL ELSE ai.acknowledged_by_display_name END,
                ack_comment = CASE WHEN v_was_cleared THEN NULL ELSE ai.ack_comment END,
                resolved_at = CASE WHEN ai.resolved_at IS NOT NULL THEN NULL ELSE ai.resolved_at END,
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

-- Paired drop of the current signature, for the same reason as 20104: the older
-- 6040 sorts after this file by name, so without it the lint reads 6040's
-- 3-argument definition as a signature change made here.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_auto_resolve(VARCHAR, INTEGER, VARCHAR, JSONB);
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint_v2  VARCHAR,
    p_context         JSONB DEFAULT NULL
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
            END,
            last_triggered_at = NOW(),
            context = CASE
                WHEN p_context IS NULL THEN ai.context
                ELSE COALESCE(ai.context, '{}'::jsonb)
                     || jsonb_build_object('cleared', p_context)
            END
        WHERE ai.organization_id = p_organization_id
          AND ai.rule_id = p_rule_id
          AND ai.fingerprint = p_fingerprint_v2
          AND ai.resolved_at IS NULL
          -- A latched alarm that already cleared is waiting for a person, not
          -- for another clear. It is not in the reactivation list above, so a
          -- second clear would fall through to 'resolved' and close it unseen.
          AND NOT (ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                   AND ai.state IN ('cleared_unack','cleared_ack'))
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
        SELECT u.id, u.state, COALESCE(p_context, '{}'::jsonb) FROM updated u
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
SET search_path TO notifications, public;

-- Back to the 20104 definitions: a latched re-fire keeps its cleared state and
-- is reported unchanged, and a second clear resolves the alarm.
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
    v_changed BOOLEAN;
    v_latched BOOLEAN;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    -- Selection only: the values are reread under the lock below.
    SELECT ai.id
    INTO v_id
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
            SELECT ai.id
            INTO v_id
            FROM notifications.alert_instances ai
            WHERE ai.rule_id = p_rule_id
              AND ai.fingerprint = p_fingerprint_v2
              AND ai.resolved_at IS NULL;
        END IF;
    END IF;

    IF v_created THEN
        v_changed := TRUE;
        -- The open is a firing too. Rule.ListFirings and the rule's last-fired
        -- time read 'triggered' rows, and a steady alert has no later fire.
        PERFORM notifications.fn_alert_transition_append(
            v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
    ELSIF v_id IS NOT NULL THEN
        -- Lock, then read. A clear committing between the scan and here blocks
        -- on this lock, so the decision below sees the row the UPDATE writes.
        SELECT ai.state, ai.resolved_at IS NOT NULL,
               ai.severity, ai.title
        INTO v_previous_state, v_was_resolved,
             v_prev_severity, v_prev_title
        FROM notifications.alert_instances ai
        WHERE ai.id = v_id
        FOR NO KEY UPDATE;

        -- A change is a (re)activation, a severity or a title. The message and
        -- context carry the reading, which moves with every status message.
        v_changed := COALESCE(v_was_resolved, FALSE)
            OR v_previous_state IN ('pending','recovering','no_data','evaluation_error')
            OR v_effective_severity IS DISTINCT FROM v_prev_severity
            OR p_title IS DISTINCT FROM v_prev_title;
        -- A latched row keeps its state on re-fire; the write is its only trace.
        v_latched := v_previous_state IN ('cleared_unack','cleared_ack');

        IF v_changed OR v_latched THEN
            UPDATE notifications.alert_instances ai
            -- Both CASE arms read ai.*, which the lock above pins to the row
            -- the decision used.
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

-- One more optional argument, so the old signature goes first. The older
-- definitions sort after this file by name; dropping the 3-argument form keeps
-- the lint from reading them as a signature change.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_auto_resolve(VARCHAR, INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint_v2  VARCHAR,
    p_context         JSONB DEFAULT NULL
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
            END,
            last_triggered_at = NOW(),
            context = CASE
                WHEN p_context IS NULL THEN ai.context
                ELSE COALESCE(ai.context, '{}'::jsonb)
                     || jsonb_build_object('cleared', p_context)
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
        SELECT u.id, u.state, COALESCE(p_context, '{}'::jsonb) FROM updated u
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
