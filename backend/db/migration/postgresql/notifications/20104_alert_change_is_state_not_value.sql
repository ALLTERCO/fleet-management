-- An alert change is its state, severity or title, never the live reading.
--
-- MEASURED (test3, 1 Oct 2026, 2,000 power-metering devices, rule "switch
-- power above 100 W"): 71,000 alert updates and 68,000 transition rows in ten
-- minutes. The threshold text holds the reading, and 20080 counted a new message
-- as a change, so almost every status message rewrote the row, appended
-- history, ran the inbox and preference lookups and sent Alert.Updated.
--
-- fn_alert_instance_upsert: the message no longer decides `changed`. The row is
-- written only on a change (or on a latched re-fire, whose write is its only
-- trace), so the stored message and context stay those of the open. The open
-- itself now appends its 'triggered' row; before, a first fire left none and
-- only the next drifting re-fire showed up in the firing history. The lock is
-- FOR NO KEY UPDATE, as in 20035; it still makes a concurrent resolve wait.
--
-- fn_alert_instance_auto_resolve: takes the clearing reading (p_context), keeps
-- it in context.cleared and in the transition, and moves last_triggered_at.
-- last_triggered_at now means the last transition, not the last message.
--
-- Delivery jobs: the key had no transition in it, so every later notice of an
-- alert (resolve, reopen) found the finished first job and nothing was sent. The
-- key now carries the alert's last transition time; a retry of one notice still
-- maps to one job.
--
-- Decision: docs/internal/decisions/alert-change-is-state-not-value.md.
--------------UP
SET search_path TO notifications, public;

-- Paired drop, as in 20080: the older 6039 sorts after this file by name.
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

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_resolved_channels(
    p_organization_id         VARCHAR,
    p_rule_id                 INTEGER,
    p_destination_channel_ids INTEGER[],
    p_alert_id                INTEGER,
    p_inbox_item_id           INTEGER
)
RETURNS TABLE (
    channel_id       INTEGER,
    provider         VARCHAR,
    idempotency_key  TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT
        c.id,
        c.provider,
        FORMAT(
            'alert:%s:at:%s:inbox:%s:channel:%s',
            p_alert_id, (SELECT FLOOR(EXTRACT(EPOCH FROM ai.last_triggered_at) * 1000000)::BIGINT
             FROM notifications.alert_instances ai WHERE ai.id = p_alert_id),
            COALESCE(p_inbox_item_id, 0), c.id
        )
    FROM notifications.alert_rule_destination_groups rdg
    JOIN notifications.destination_groups dg
      ON dg.id = rdg.destination_group_id
     AND dg.organization_id = p_organization_id
     AND dg.enabled = TRUE
    JOIN notifications.destination_group_members m
      ON m.destination_group_id = dg.id
     AND m.member_type = 'channel'
     AND m.member_id ~ '^[0-9]+$'
    JOIN notifications.channels c
      ON c.id = m.member_id::INTEGER
     AND c.organization_id = p_organization_id
     AND c.enabled = TRUE
    WHERE rdg.rule_id = p_rule_id

    UNION

    SELECT DISTINCT
        c.id,
        c.provider,
        FORMAT(
            'alert:%s:at:%s:inbox:%s:channel:%s',
            p_alert_id, (SELECT FLOOR(EXTRACT(EPOCH FROM ai.last_triggered_at) * 1000000)::BIGINT
             FROM notifications.alert_instances ai WHERE ai.id = p_alert_id),
            COALESCE(p_inbox_item_id, 0), c.id
        )
    FROM notifications.channels c
    WHERE c.id = ANY(COALESCE(p_destination_channel_ids, ARRAY[]::INTEGER[]))
      AND c.organization_id = p_organization_id
      AND c.enabled = TRUE;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_for_contact_points(
    p_organization_id        VARCHAR,
    p_destination_group_ids  INTEGER[],
    p_channel_ids            INTEGER[],
    p_alert_id               INTEGER,
    p_inbox_item_id          INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
LANGUAGE sql
AS $$
    WITH group_channels AS (
        SELECT DISTINCT c.id AS channel_id, c.provider
        FROM notifications.destination_groups dg
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'channel'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.channels c
          ON c.id = m.member_id::INTEGER
         AND c.organization_id = p_organization_id
         AND c.enabled = TRUE
        WHERE dg.organization_id = p_organization_id
          AND dg.enabled = TRUE
          AND dg.id = ANY(COALESCE(p_destination_group_ids, ARRAY[]::INTEGER[]))
    ),
    direct_channels AS (
        SELECT DISTINCT c.id AS channel_id, c.provider
        FROM notifications.channels c
        WHERE c.organization_id = p_organization_id
          AND c.enabled = TRUE
          AND c.id = ANY(COALESCE(p_channel_ids, ARRAY[]::INTEGER[]))
    ),
    channels AS (
        SELECT
            channel_id,
            provider,
            FORMAT(
                'alert:%s:at:%s:inbox:%s:channel:%s',
                p_alert_id,
                (SELECT FLOOR(EXTRACT(EPOCH FROM ai.last_triggered_at) * 1000000)::BIGINT
                 FROM notifications.alert_instances ai WHERE ai.id = p_alert_id),
                COALESCE(p_inbox_item_id, 0),
                channel_id
            ) AS idempotency_key
        FROM (
            SELECT channel_id, provider FROM group_channels
            UNION
            SELECT channel_id, provider FROM direct_channels
        ) combined
    ),
    inserted AS (
        INSERT INTO notifications.delivery_jobs (
            organization_id, alert_id, inbox_item_id, endpoint_id, state,
            idempotency_key
        )
        SELECT
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            ch.channel_id,
            'queued',
            ch.idempotency_key
        FROM channels ch
        ON CONFLICT (organization_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            DO NOTHING
        RETURNING id, endpoint_id, idempotency_key
    )
    SELECT i.id, i.endpoint_id, ch.provider
    FROM inserted i
    JOIN channels ch ON ch.idempotency_key = i.idempotency_key
    UNION ALL
    SELECT j.id, j.endpoint_id, ch.provider
    FROM channels ch
    JOIN notifications.delivery_jobs j
      ON j.organization_id = p_organization_id
     AND j.idempotency_key = ch.idempotency_key
    WHERE NOT EXISTS (
        SELECT 1 FROM inserted i WHERE i.id = j.id
    );
$$;

--------------DOWN
SET search_path TO notifications, public;

-- Restore the 20080 upsert, the 6934 resolve and the 20022 job keys.
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
    ELSIF v_id IS NOT NULL THEN
        -- Lock, then read. A clear committing between the scan and here blocks
        -- on this lock, so the decision below sees the row the UPDATE writes.
        SELECT ai.state, ai.resolved_at IS NOT NULL,
               ai.severity, ai.title, ai.message
        INTO v_previous_state, v_was_resolved,
             v_prev_severity, v_prev_title, v_prev_message
        FROM notifications.alert_instances ai
        WHERE ai.id = v_id
        FOR UPDATE;

        -- Material change: (re)activation transition, or a severity/title/
        -- message drift (values live in title/message).
        v_changed := COALESCE(v_was_resolved, FALSE)
            OR v_previous_state IN ('pending','recovering','no_data','evaluation_error')
            OR v_effective_severity IS DISTINCT FROM v_prev_severity
            OR p_title IS DISTINCT FROM v_prev_title
            OR p_message IS DISTINCT FROM v_prev_message;

        UPDATE notifications.alert_instances ai
        -- Both CASE arms read ai.*, which the lock above pins to the row the
        -- decision used.
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

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_auto_resolve(VARCHAR, INTEGER, VARCHAR, JSONB);
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

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_resolved_channels(
    p_organization_id         VARCHAR,
    p_rule_id                 INTEGER,
    p_destination_channel_ids INTEGER[],
    p_alert_id                INTEGER,
    p_inbox_item_id           INTEGER
)
RETURNS TABLE (
    channel_id       INTEGER,
    provider         VARCHAR,
    idempotency_key  TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT
        c.id,
        c.provider,
        FORMAT(
            'alert:%s:inbox:%s:channel:%s',
            p_alert_id, COALESCE(p_inbox_item_id, 0), c.id
        )
    FROM notifications.alert_rule_destination_groups rdg
    JOIN notifications.destination_groups dg
      ON dg.id = rdg.destination_group_id
     AND dg.organization_id = p_organization_id
     AND dg.enabled = TRUE
    JOIN notifications.destination_group_members m
      ON m.destination_group_id = dg.id
     AND m.member_type = 'channel'
     AND m.member_id ~ '^[0-9]+$'
    JOIN notifications.channels c
      ON c.id = m.member_id::INTEGER
     AND c.organization_id = p_organization_id
     AND c.enabled = TRUE
    WHERE rdg.rule_id = p_rule_id

    UNION

    SELECT DISTINCT
        c.id,
        c.provider,
        FORMAT(
            'alert:%s:inbox:%s:channel:%s',
            p_alert_id, COALESCE(p_inbox_item_id, 0), c.id
        )
    FROM notifications.channels c
    WHERE c.id = ANY(COALESCE(p_destination_channel_ids, ARRAY[]::INTEGER[]))
      AND c.organization_id = p_organization_id
      AND c.enabled = TRUE;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_for_contact_points(
    p_organization_id        VARCHAR,
    p_destination_group_ids  INTEGER[],
    p_channel_ids            INTEGER[],
    p_alert_id               INTEGER,
    p_inbox_item_id          INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
LANGUAGE sql
AS $$
    WITH group_channels AS (
        SELECT DISTINCT c.id AS channel_id, c.provider
        FROM notifications.destination_groups dg
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'channel'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.channels c
          ON c.id = m.member_id::INTEGER
         AND c.organization_id = p_organization_id
         AND c.enabled = TRUE
        WHERE dg.organization_id = p_organization_id
          AND dg.enabled = TRUE
          AND dg.id = ANY(COALESCE(p_destination_group_ids, ARRAY[]::INTEGER[]))
    ),
    direct_channels AS (
        SELECT DISTINCT c.id AS channel_id, c.provider
        FROM notifications.channels c
        WHERE c.organization_id = p_organization_id
          AND c.enabled = TRUE
          AND c.id = ANY(COALESCE(p_channel_ids, ARRAY[]::INTEGER[]))
    ),
    channels AS (
        SELECT
            channel_id,
            provider,
            FORMAT(
                'alert:%s:inbox:%s:channel:%s',
                p_alert_id,
                COALESCE(p_inbox_item_id, 0),
                channel_id
            ) AS idempotency_key
        FROM (
            SELECT channel_id, provider FROM group_channels
            UNION
            SELECT channel_id, provider FROM direct_channels
        ) combined
    ),
    inserted AS (
        INSERT INTO notifications.delivery_jobs (
            organization_id, alert_id, inbox_item_id, endpoint_id, state,
            idempotency_key
        )
        SELECT
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            ch.channel_id,
            'queued',
            ch.idempotency_key
        FROM channels ch
        ON CONFLICT (organization_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            DO NOTHING
        RETURNING id, endpoint_id, idempotency_key
    )
    SELECT i.id, i.endpoint_id, ch.provider
    FROM inserted i
    JOIN channels ch ON ch.idempotency_key = i.idempotency_key
    UNION ALL
    SELECT j.id, j.endpoint_id, ch.provider
    FROM channels ch
    JOIN notifications.delivery_jobs j
      ON j.organization_id = p_organization_id
     AND j.idempotency_key = ch.idempotency_key
    WHERE NOT EXISTS (
        SELECT 1 FROM inserted i WHERE i.id = j.id
    );
$$;
