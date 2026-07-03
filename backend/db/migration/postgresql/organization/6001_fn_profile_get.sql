--------------UP
CREATE OR REPLACE FUNCTION organization.fn_profile_get(
    p_id VARCHAR
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
LANGUAGE sql
AS $$
    SELECT id, name, display_name, timezone_default, locale_default,
           metadata, created_at, updated_at
    FROM organization.profile
    WHERE id = p_id;
$$;
--------------DOWN
DROP FUNCTION organization.fn_profile_get;
