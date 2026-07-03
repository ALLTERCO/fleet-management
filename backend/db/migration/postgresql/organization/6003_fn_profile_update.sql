--------------UP
-- Partial update. NULL params leave field untouched; `p_clear_*` flags explicitly null.
CREATE OR REPLACE FUNCTION organization.fn_profile_update(
    p_id                    VARCHAR,
    p_display_name          VARCHAR DEFAULT NULL,
    p_clear_display_name    BOOLEAN DEFAULT FALSE,
    p_timezone_default      VARCHAR DEFAULT NULL,
    p_clear_timezone        BOOLEAN DEFAULT FALSE,
    p_locale_default        VARCHAR DEFAULT NULL,
    p_clear_locale          BOOLEAN DEFAULT FALSE,
    p_metadata              JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id                VARCHAR,
    name              VARCHAR,
    display_name      VARCHAR,
    timezone_default  VARCHAR,
    locale_default    VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_id);
    RETURN QUERY
    UPDATE organization.profile SET
        display_name = CASE
            WHEN p_clear_display_name THEN NULL
            WHEN p_display_name IS NOT NULL THEN p_display_name
            ELSE profile.display_name
        END,
        timezone_default = CASE
            WHEN p_clear_timezone THEN NULL
            WHEN p_timezone_default IS NOT NULL THEN p_timezone_default
            ELSE profile.timezone_default
        END,
        locale_default = CASE
            WHEN p_clear_locale THEN NULL
            WHEN p_locale_default IS NOT NULL THEN p_locale_default
            ELSE profile.locale_default
        END,
        metadata = COALESCE(p_metadata, profile.metadata),
        updated_at = NOW()
    WHERE profile.id = p_id
    RETURNING profile.id, profile.name, profile.display_name,
              profile.timezone_default, profile.locale_default,
              profile.metadata, profile.created_at, profile.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_profile_update;
