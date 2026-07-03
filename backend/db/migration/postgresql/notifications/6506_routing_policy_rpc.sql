--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_routing_policy_list(
    p_organization_id VARCHAR,
    p_enabled_only    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id                 BIGINT,
    organization_id    VARCHAR,
    parent_policy_id   BIGINT,
    name               VARCHAR,
    sort_order         INTEGER,
    label_matchers     JSONB,
    severity_matchers  JSONB,
    resource_selectors JSONB,
    contact_points     JSONB,
    grouping_keys      JSONB,
    mute_windows       JSONB,
    runtime_silences   JSONB,
    inhibition_rules   JSONB,
    escalation_stages  JSONB,
    enabled            BOOLEAN,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        id,
        organization_id,
        parent_policy_id,
        name,
        sort_order,
        label_matchers,
        severity_matchers,
        resource_selectors,
        contact_points,
        grouping_keys,
        mute_windows,
        runtime_silences,
        inhibition_rules,
        escalation_stages,
        enabled,
        created_at,
        updated_at
    FROM notifications.routing_policies
    WHERE organization_id = p_organization_id
      AND (NOT p_enabled_only OR enabled)
    ORDER BY parent_policy_id NULLS FIRST, sort_order, LOWER(name), id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_routing_policy_upsert(
    p_organization_id    VARCHAR,
    p_policy_id          BIGINT DEFAULT NULL,
    p_parent_policy_id   BIGINT DEFAULT NULL,
    p_name               VARCHAR DEFAULT NULL,
    p_sort_order         INTEGER DEFAULT 0,
    p_label_matchers     JSONB DEFAULT '[]'::jsonb,
    p_severity_matchers  JSONB DEFAULT '[]'::jsonb,
    p_resource_selectors JSONB DEFAULT '[]'::jsonb,
    p_contact_points     JSONB DEFAULT '[]'::jsonb,
    p_grouping_keys      JSONB DEFAULT '[]'::jsonb,
    p_mute_windows       JSONB DEFAULT '[]'::jsonb,
    p_runtime_silences   JSONB DEFAULT '[]'::jsonb,
    p_inhibition_rules   JSONB DEFAULT '[]'::jsonb,
    p_escalation_stages  JSONB DEFAULT '[]'::jsonb,
    p_enabled            BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    id                 BIGINT,
    organization_id    VARCHAR,
    parent_policy_id   BIGINT,
    name               VARCHAR,
    sort_order         INTEGER,
    label_matchers     JSONB,
    severity_matchers  JSONB,
    resource_selectors JSONB,
    contact_points     JSONB,
    grouping_keys      JSONB,
    mute_windows       JSONB,
    runtime_silences   JSONB,
    inhibition_rules   JSONB,
    escalation_stages  JSONB,
    enabled            BOOLEAN,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_policy_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.routing_policies
        SET
            parent_policy_id   = p_parent_policy_id,
            name               = COALESCE(p_name, routing_policies.name),
            sort_order         = COALESCE(p_sort_order, routing_policies.sort_order),
            label_matchers     = COALESCE(p_label_matchers, routing_policies.label_matchers),
            severity_matchers  = COALESCE(p_severity_matchers, routing_policies.severity_matchers),
            resource_selectors = COALESCE(p_resource_selectors, routing_policies.resource_selectors),
            contact_points     = COALESCE(p_contact_points, routing_policies.contact_points),
            grouping_keys      = COALESCE(p_grouping_keys, routing_policies.grouping_keys),
            mute_windows       = COALESCE(p_mute_windows, routing_policies.mute_windows),
            runtime_silences   = COALESCE(p_runtime_silences, routing_policies.runtime_silences),
            inhibition_rules   = COALESCE(p_inhibition_rules, routing_policies.inhibition_rules),
            escalation_stages  = COALESCE(p_escalation_stages, routing_policies.escalation_stages),
            enabled            = COALESCE(p_enabled, routing_policies.enabled),
            updated_at         = NOW()
        WHERE organization_id = p_organization_id
          AND id = p_policy_id
        RETURNING
            routing_policies.id,
            routing_policies.organization_id,
            routing_policies.parent_policy_id,
            routing_policies.name,
            routing_policies.sort_order,
            routing_policies.label_matchers,
            routing_policies.severity_matchers,
            routing_policies.resource_selectors,
            routing_policies.contact_points,
            routing_policies.grouping_keys,
            routing_policies.mute_windows,
            routing_policies.runtime_silences,
            routing_policies.inhibition_rules,
            routing_policies.escalation_stages,
            routing_policies.enabled,
            routing_policies.created_at,
            routing_policies.updated_at;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO notifications.routing_policies (
        organization_id,
        parent_policy_id,
        name,
        sort_order,
        label_matchers,
        severity_matchers,
        resource_selectors,
        contact_points,
        grouping_keys,
        mute_windows,
        runtime_silences,
        inhibition_rules,
        escalation_stages,
        enabled,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_parent_policy_id,
        p_name,
        COALESCE(p_sort_order, 0),
        COALESCE(p_label_matchers, '[]'::jsonb),
        COALESCE(p_severity_matchers, '[]'::jsonb),
        COALESCE(p_resource_selectors, '[]'::jsonb),
        COALESCE(p_contact_points, '[]'::jsonb),
        COALESCE(p_grouping_keys, '[]'::jsonb),
        COALESCE(p_mute_windows, '[]'::jsonb),
        COALESCE(p_runtime_silences, '[]'::jsonb),
        COALESCE(p_inhibition_rules, '[]'::jsonb),
        COALESCE(p_escalation_stages, '[]'::jsonb),
        COALESCE(p_enabled, TRUE),
        NOW()
    )
    RETURNING
        routing_policies.id,
        routing_policies.organization_id,
        routing_policies.parent_policy_id,
        routing_policies.name,
        routing_policies.sort_order,
        routing_policies.label_matchers,
        routing_policies.severity_matchers,
        routing_policies.resource_selectors,
        routing_policies.contact_points,
        routing_policies.grouping_keys,
        routing_policies.mute_windows,
        routing_policies.runtime_silences,
        routing_policies.inhibition_rules,
        routing_policies.escalation_stages,
        routing_policies.enabled,
        routing_policies.created_at,
        routing_policies.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_routing_policy_delete(
    p_organization_id VARCHAR,
    p_policy_id       BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM notifications.routing_policies
        WHERE organization_id = p_organization_id
          AND id = p_policy_id
        RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_routing_policy_delete(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_routing_policy_upsert(
    VARCHAR, BIGINT, BIGINT, VARCHAR, INTEGER, JSONB, JSONB, JSONB, JSONB,
    JSONB, JSONB, JSONB, JSONB, JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_routing_policy_list(VARCHAR, BOOLEAN);
