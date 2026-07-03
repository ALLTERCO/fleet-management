--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_user_notification_preference_list(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR
)
RETURNS TABLE (
    user_id           VARCHAR,
    channel_type      VARCHAR,
    severity_filters  JSONB,
    quiet_hours       JSONB,
    digest_preference JSONB,
    disabled          BOOLEAN,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        user_id,
        channel_type,
        severity_filters,
        quiet_hours,
        digest_preference,
        disabled,
        created_at,
        updated_at
    FROM notifications.user_notification_preferences
    WHERE organization_id = p_organization_id
      AND user_id = p_user_id
    ORDER BY channel_type;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_user_notification_preference_upsert(
    p_organization_id    VARCHAR,
    p_user_id            VARCHAR,
    p_channel_type       VARCHAR,
    p_severity_filters   JSONB DEFAULT '["info","warning","critical"]'::jsonb,
    p_quiet_hours        JSONB DEFAULT '{}'::jsonb,
    p_digest_preference  JSONB DEFAULT '{"mode":"immediate"}'::jsonb,
    p_disabled           BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    user_id           VARCHAR,
    channel_type      VARCHAR,
    severity_filters  JSONB,
    quiet_hours       JSONB,
    digest_preference JSONB,
    disabled          BOOLEAN,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.user_notification_preferences (
        organization_id,
        user_id,
        channel_type,
        severity_filters,
        quiet_hours,
        digest_preference,
        disabled,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_user_id,
        p_channel_type,
        COALESCE(p_severity_filters, '["info","warning","critical"]'::jsonb),
        COALESCE(p_quiet_hours, '{}'::jsonb),
        COALESCE(p_digest_preference, '{"mode":"immediate"}'::jsonb),
        COALESCE(p_disabled, FALSE),
        NOW()
    )
    ON CONFLICT (organization_id, user_id, channel_type)
    DO UPDATE SET
        severity_filters  = EXCLUDED.severity_filters,
        quiet_hours       = EXCLUDED.quiet_hours,
        digest_preference = EXCLUDED.digest_preference,
        disabled          = EXCLUDED.disabled,
        updated_at        = NOW()
    RETURNING
        user_id,
        channel_type,
        severity_filters,
        quiet_hours,
        digest_preference,
        disabled,
        created_at,
        updated_at;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_user_notification_preference_upsert(
    VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_user_notification_preference_list(
    VARCHAR, VARCHAR
);
