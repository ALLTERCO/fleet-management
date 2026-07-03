--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_on_call_schedule_list(
    p_organization_id VARCHAR,
    p_enabled_only    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    name            VARCHAR,
    timezone        VARCHAR,
    rotation_rules  JSONB,
    overrides       JSONB,
    target          JSONB,
    enabled         BOOLEAN,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        id,
        organization_id,
        name,
        timezone,
        rotation_rules,
        overrides,
        target,
        enabled,
        created_at,
        updated_at
    FROM notifications.on_call_schedules
    WHERE organization_id = p_organization_id
      AND (NOT p_enabled_only OR enabled)
    ORDER BY LOWER(name), id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_on_call_schedule_get(
    p_organization_id VARCHAR,
    p_schedule_id     BIGINT
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    name            VARCHAR,
    timezone        VARCHAR,
    rotation_rules  JSONB,
    overrides       JSONB,
    target          JSONB,
    enabled         BOOLEAN,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        id,
        organization_id,
        name,
        timezone,
        rotation_rules,
        overrides,
        target,
        enabled,
        created_at,
        updated_at
    FROM notifications.on_call_schedules
    WHERE organization_id = p_organization_id
      AND id = p_schedule_id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_on_call_schedule_upsert(
    p_organization_id VARCHAR,
    p_schedule_id     BIGINT DEFAULT NULL,
    p_name            VARCHAR DEFAULT NULL,
    p_timezone        VARCHAR DEFAULT 'UTC',
    p_rotation_rules  JSONB DEFAULT '[]'::jsonb,
    p_overrides       JSONB DEFAULT '[]'::jsonb,
    p_target          JSONB DEFAULT '{}'::jsonb,
    p_enabled         BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    name            VARCHAR,
    timezone        VARCHAR,
    rotation_rules  JSONB,
    overrides       JSONB,
    target          JSONB,
    enabled         BOOLEAN,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_schedule_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.on_call_schedules
        SET
            name           = COALESCE(p_name, on_call_schedules.name),
            timezone       = COALESCE(p_timezone, on_call_schedules.timezone),
            rotation_rules = COALESCE(p_rotation_rules, on_call_schedules.rotation_rules),
            overrides      = COALESCE(p_overrides, on_call_schedules.overrides),
            target         = COALESCE(p_target, on_call_schedules.target),
            enabled        = COALESCE(p_enabled, on_call_schedules.enabled),
            updated_at     = NOW()
        WHERE organization_id = p_organization_id
          AND id = p_schedule_id
        RETURNING
            on_call_schedules.id,
            on_call_schedules.organization_id,
            on_call_schedules.name,
            on_call_schedules.timezone,
            on_call_schedules.rotation_rules,
            on_call_schedules.overrides,
            on_call_schedules.target,
            on_call_schedules.enabled,
            on_call_schedules.created_at,
            on_call_schedules.updated_at;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO notifications.on_call_schedules (
        organization_id,
        name,
        timezone,
        rotation_rules,
        overrides,
        target,
        enabled,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_name,
        COALESCE(p_timezone, 'UTC'),
        COALESCE(p_rotation_rules, '[]'::jsonb),
        COALESCE(p_overrides, '[]'::jsonb),
        COALESCE(p_target, '{}'::jsonb),
        COALESCE(p_enabled, TRUE),
        NOW()
    )
    RETURNING
        on_call_schedules.id,
        on_call_schedules.organization_id,
        on_call_schedules.name,
        on_call_schedules.timezone,
        on_call_schedules.rotation_rules,
        on_call_schedules.overrides,
        on_call_schedules.target,
        on_call_schedules.enabled,
        on_call_schedules.created_at,
        on_call_schedules.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_on_call_schedule_delete(
    p_organization_id VARCHAR,
    p_schedule_id     BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM notifications.on_call_schedules
        WHERE organization_id = p_organization_id
          AND id = p_schedule_id
        RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_on_call_schedule_delete(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_on_call_schedule_upsert(
    VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_on_call_schedule_get(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_on_call_schedule_list(VARCHAR, BOOLEAN);
