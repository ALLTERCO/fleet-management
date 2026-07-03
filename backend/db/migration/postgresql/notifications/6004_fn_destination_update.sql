--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_update(
    p_organization_id    VARCHAR,
    p_id                 INTEGER,
    p_name               VARCHAR DEFAULT NULL,
    p_description        VARCHAR DEFAULT NULL,
    p_clear_description  BOOLEAN DEFAULT FALSE,
    p_enabled            BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    name                VARCHAR,
    description         VARCHAR,
    enabled             BOOLEAN,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    c_members           BIGINT,
    c_rules_referencing BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.destination_groups d
        SET
            name = COALESCE(p_name, d.name),
            description = CASE
                WHEN p_clear_description THEN NULL
                WHEN p_description IS NOT NULL THEN p_description
                ELSE d.description
            END,
            enabled = COALESCE(p_enabled, d.enabled),
            updated_at = NOW()
        WHERE d.id = p_id
          AND d.organization_id = p_organization_id
        RETURNING d.*
    )
    SELECT
        u.id, u.organization_id, u.name, u.description, u.enabled,
        u.created_at, u.updated_at,
        COALESCE(m.c_members, 0)::BIGINT,
        COALESCE(r.c_rules_referencing, 0)::BIGINT
    FROM updated u
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c_members
        FROM notifications.destination_group_members m
        WHERE m.destination_group_id = u.id
    ) m ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c_rules_referencing
        FROM notifications.alert_rule_destination_groups r
        WHERE r.destination_group_id = u.id
    ) r ON TRUE;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_update;
