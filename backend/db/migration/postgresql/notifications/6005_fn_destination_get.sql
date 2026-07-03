--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
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
LANGUAGE sql
AS $$
    SELECT
        d.id, d.organization_id, d.name, d.description, d.enabled,
        d.created_at, d.updated_at,
        COALESCE(m.c_members, 0)::BIGINT AS c_members,
        COALESCE(r.c_rules_referencing, 0)::BIGINT AS c_rules_referencing
    FROM notifications.destination_groups d
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c_members
        FROM notifications.destination_group_members m
        WHERE m.destination_group_id = d.id
    ) m ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c_rules_referencing
        FROM notifications.alert_rule_destination_groups r
        WHERE r.destination_group_id = d.id
    ) r ON TRUE
    WHERE d.organization_id = p_organization_id
      AND d.id = p_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_get;
