--------------UP
-- Idempotent alert upsert keyed on (rule_id, fingerprint) while not
-- resolved. Repeat matches touch `last_triggered_at` + `context`; they
-- never spawn a duplicate active alert per spec §8.1. The caller sets
-- `p_is_new` semantics via the returned `was_created` flag so the
-- engine can decide which transition to append and whether to raise
-- Alert.Created vs Alert.Updated.
--
-- The unique partial index `alert_instances_rule_fingerprint_active`
-- (resolved_at IS NULL) guarantees at most one active row per
-- fingerprint; this function uses it as the conflict target.
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_upsert(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_rule_kind       VARCHAR,
    p_severity        VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_title           VARCHAR,
    p_message         TEXT,
    p_fingerprint     VARCHAR,
    p_context         JSONB DEFAULT '{}'::jsonb
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
BEGIN
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
            severity          = p_severity,
            title             = p_title,
            message           = p_message
        WHERE ai.id = v_existing.id;

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
            p_organization_id, p_rule_id, p_rule_kind, 'active', p_severity,
            p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint, p_context
        )
        RETURNING *
    )
    SELECT i.*, TRUE AS was_created FROM inserted i;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_instance_upsert;
