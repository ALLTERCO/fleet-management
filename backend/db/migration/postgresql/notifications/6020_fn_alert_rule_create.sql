--------------UP
-- Required params (no default) come first to satisfy PG's parameter-default ordering rule.
-- Call sites in AlertComponent use named arguments so ordering is transparent.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_create(
    p_organization_id     VARCHAR,
    p_name                VARCHAR,
    p_kind                VARCHAR,
    p_severity            VARCHAR,
    p_enabled             BOOLEAN DEFAULT TRUE,
    p_scope               JSONB DEFAULT '{}'::jsonb,
    p_dedupe_window_sec   INTEGER DEFAULT 0,
    p_cooldown_sec        INTEGER DEFAULT 0,
    p_owner_user_id       VARCHAR DEFAULT NULL,
    p_summary_template    TEXT DEFAULT NULL,
    p_message_template    TEXT DEFAULT NULL,
    p_auto_resolve        BOOLEAN DEFAULT TRUE,
    p_config              JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id                     INTEGER,
    organization_id        VARCHAR,
    name                   VARCHAR,
    kind                   VARCHAR,
    enabled                BOOLEAN,
    severity               VARCHAR,
    scope                  JSONB,
    dedupe_window_sec      INTEGER,
    cooldown_sec           INTEGER,
    destination_group_ids  INTEGER[],
    owner_user_id          VARCHAR,
    summary_template       TEXT,
    message_template       TEXT,
    auto_resolve           BOOLEAN,
    config                 JSONB,
    created_at             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.alert_rules (
            organization_id,
            name,
            kind,
            enabled,
            severity,
            scope,
            dedupe_window_sec,
            cooldown_sec,
            owner_user_id,
            summary_template,
            message_template,
            auto_resolve,
            config
        )
        VALUES (
            p_organization_id,
            p_name,
            p_kind,
            COALESCE(p_enabled, TRUE),
            p_severity,
            COALESCE(p_scope, '{}'::jsonb),
            COALESCE(p_dedupe_window_sec, 0),
            COALESCE(p_cooldown_sec, 0),
            p_owner_user_id,
            p_summary_template,
            p_message_template,
            COALESCE(p_auto_resolve, TRUE),
            COALESCE(p_config, '{}'::jsonb)
        )
        RETURNING *
    )
    SELECT
        i.id,
        i.organization_id,
        i.name,
        i.kind,
        i.enabled,
        i.severity,
        i.scope,
        i.dedupe_window_sec,
        i.cooldown_sec,
        ARRAY[]::INTEGER[] AS destination_group_ids,
        i.owner_user_id,
        i.summary_template,
        i.message_template,
        i.auto_resolve,
        i.config,
        i.created_at,
        i.updated_at
    FROM inserted i;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_create;
