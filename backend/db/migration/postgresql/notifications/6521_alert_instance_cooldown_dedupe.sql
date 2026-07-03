--------------UP
-- cooldownSec + dedupeWindowSec wiring on top of 6519.

ALTER TABLE notifications.alert_instances
    ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_record_notification(
    p_id INTEGER
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
AS $$
    UPDATE notifications.alert_instances
       SET last_notified_at = NOW()
     WHERE id = p_id
    RETURNING last_notified_at;
$$;

-- Adds p_dedupe_window_sec + last_notified_at in the return shape.
-- Re-opens recently-resolved rows when the window covers them.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_upsert(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT,
    VARCHAR, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR
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
    p_fingerprint               VARCHAR,
    p_context                   JSONB   DEFAULT '{}'::jsonb,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_dedupe_window_sec         INTEGER DEFAULT 0
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
    v_existing notifications.alert_instances%ROWTYPE;
    v_effective_severity VARCHAR;
    v_window INTERVAL := COALESCE(p_dedupe_window_sec, 0) * INTERVAL '1 second';
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT * INTO v_existing
    FROM notifications.alert_instances ai
    WHERE ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint
      AND (
          ai.resolved_at IS NULL
          OR (v_window > INTERVAL '0' AND ai.resolved_at > NOW() - v_window)
      )
    ORDER BY ai.resolved_at NULLS FIRST
    LIMIT 1;

    IF FOUND THEN
        IF v_existing.resolved_at IS NOT NULL THEN
            UPDATE notifications.alert_instances ai
            SET state             = 'active',
                resolved_at       = NULL,
                last_triggered_at = NOW(),
                context           = p_context,
                severity          = v_effective_severity,
                title             = p_title,
                message           = p_message
            WHERE ai.id = v_existing.id;
        ELSE
            UPDATE notifications.alert_instances ai
            SET last_triggered_at = NOW(),
                context           = p_context,
                severity          = v_effective_severity,
                title             = p_title,
                message           = p_message
            WHERE ai.id = v_existing.id;
        END IF;

        PERFORM notifications.fn_alert_transition_append(
            v_existing.id,
            'triggered',
            NULL,
            NULL,
            COALESCE(p_context, '{}'::jsonb)
        );

        RETURN QUERY
        SELECT ai.*, FALSE AS was_created
        FROM notifications.alert_instances ai
        WHERE ai.id = v_existing.id;
        RETURN;
    END IF;

    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.alert_instances (
            organization_id, rule_id, rule_kind, state, severity,
            source_subject_type, source_subject_id,
            title, message, fingerprint, context
        )
        VALUES (
            p_organization_id, p_rule_id, p_rule_kind, 'active',
            v_effective_severity,
            p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint, p_context
        )
        RETURNING *
    )
    SELECT i.*, TRUE AS was_created FROM inserted i;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_record_notification(INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_upsert(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT,
    VARCHAR, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER
);

-- Restore 6519's signature + body (floor-aware + 'triggered' append).
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_upsert(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_severity                  VARCHAR,
    p_subject_type              VARCHAR,
    p_subject_id                VARCHAR,
    p_title                     VARCHAR,
    p_message                   TEXT,
    p_fingerprint               VARCHAR,
    p_context                   JSONB   DEFAULT '{}'::jsonb,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL
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
    context                      JSONB,
    was_created                  BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing notifications.alert_instances%ROWTYPE;
    v_effective_severity VARCHAR;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT * INTO v_existing
    FROM notifications.alert_instances ai
    WHERE ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint
      AND ai.resolved_at IS NULL
    LIMIT 1;

    IF FOUND THEN
        UPDATE notifications.alert_instances ai
        SET last_triggered_at = NOW(),
            context           = p_context,
            severity          = v_effective_severity,
            title             = p_title,
            message           = p_message
        WHERE ai.id = v_existing.id;

        PERFORM notifications.fn_alert_transition_append(
            v_existing.id,
            'triggered',
            NULL,
            NULL,
            COALESCE(p_context, '{}'::jsonb)
        );

        RETURN QUERY
        SELECT ai.*, FALSE AS was_created
        FROM notifications.alert_instances ai
        WHERE ai.id = v_existing.id;
        RETURN;
    END IF;

    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.alert_instances (
            organization_id, rule_id, rule_kind, state, severity,
            source_subject_type, source_subject_id,
            title, message, fingerprint, context
        )
        VALUES (
            p_organization_id, p_rule_id, p_rule_kind, 'active',
            v_effective_severity,
            p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint, p_context
        )
        RETURNING *
    )
    SELECT i.*, TRUE AS was_created FROM inserted i;
END;
$$;

ALTER TABLE notifications.alert_instances
    DROP COLUMN IF EXISTS last_notified_at;
