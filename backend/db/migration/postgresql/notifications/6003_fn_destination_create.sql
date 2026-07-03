--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_create(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_enabled         BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    id                 INTEGER,
    organization_id    VARCHAR,
    name               VARCHAR,
    description        VARCHAR,
    enabled            BOOLEAN,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ,
    c_members          BIGINT,
    c_rules_referencing BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.destination_groups (
            organization_id, name, description, enabled
        )
        VALUES (
            p_organization_id,
            p_name,
            p_description,
            COALESCE(p_enabled, TRUE)
        )
        RETURNING *
    )
    SELECT
        i.id, i.organization_id, i.name, i.description, i.enabled,
        i.created_at, i.updated_at,
        0::BIGINT AS c_members,
        0::BIGINT AS c_rules_referencing
    FROM inserted i;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_create;
