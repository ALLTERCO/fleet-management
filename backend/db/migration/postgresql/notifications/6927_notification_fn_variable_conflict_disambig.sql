--------------UP
-- Same plpgsql variable-vs-column ambiguity fixed in notifications/6926,
-- 6416 and organization/6104. Each RETURNS TABLE OUT param (id,
-- organization_id, endpoint_id, ...) collides with a same-named column in an
-- unqualified UPDATE inside the body. Under the default
-- plpgsql.variable_conflict = error these raise "column reference ... is
-- ambiguous" on the edit/collapse path (the INSERT/create path is unaffected,
-- which is why create works and edit throws). Bodies are identical to their
-- source migrations; only #variable_conflict use_column is added.

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_for_group(
    p_alert_ids   INTEGER[],
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    id           INTEGER,
    endpoint_id  INTEGER,
    provider     VARCHAR
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_latest_ids INTEGER[];
BEGIN
    -- Pick the latest queued job per alert_id for this endpoint.
    SELECT COALESCE(ARRAY_AGG(t.id), ARRAY[]::INTEGER[])
    INTO v_latest_ids
    FROM (
        SELECT DISTINCT ON (j.alert_id) j.id
        FROM notifications.delivery_jobs j
        WHERE j.alert_id = ANY(p_alert_ids)
          AND j.endpoint_id = p_endpoint_id
          AND j.state = 'queued'
        ORDER BY j.alert_id, j.created_at DESC, j.id DESC
    ) t;

    -- Collapse the older queued siblings so they don't sit forever.
    UPDATE notifications.delivery_jobs
    SET state = 'superseded',
        completed_at = NOW()
    WHERE alert_id = ANY(p_alert_ids)
      AND endpoint_id = p_endpoint_id
      AND state = 'queued'
      AND NOT (id = ANY(v_latest_ids));

    RETURN QUERY
    SELECT j.id, j.endpoint_id, e.provider
    FROM notifications.delivery_jobs j
    JOIN notifications.integration_endpoints e ON e.id = j.endpoint_id
    WHERE j.id = ANY(v_latest_ids);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_requeue(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    alert_id            INTEGER,
    inbox_item_id       INTEGER,
    endpoint_id         INTEGER,
    state               VARCHAR,
    created_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    attempt_count       INTEGER,
    alert_title         VARCHAR,
    alert_message       TEXT,
    alert_severity      VARCHAR,
    alert_state         VARCHAR,
    alert_rule_kind     VARCHAR,
    alert_active_since  TIMESTAMPTZ,
    alert_fired_at      TIMESTAMPTZ,
    source_subject_type VARCHAR,
    source_subject_id   VARCHAR,
    rule_id             INTEGER,
    rule_name           VARCHAR
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_state     VARCHAR;
    v_alert_id  INTEGER;
BEGIN
    SELECT j.state, j.alert_id INTO v_state, v_alert_id
    FROM notifications.delivery_jobs j
    WHERE j.id = p_id AND j.organization_id = p_organization_id;

    IF v_state IS NULL THEN
        RAISE EXCEPTION 'delivery_job % not found in org %', p_id, p_organization_id
            USING ERRCODE = '02000';
    END IF;
    IF v_state NOT IN ('failed', 'dead_letter') THEN
        RAISE EXCEPTION 'delivery_job % is % (only failed/dead-letter jobs can be requeued)', p_id, v_state
            USING ERRCODE = 'P0001';
    END IF;
    IF v_alert_id IS NULL THEN
        RAISE EXCEPTION 'delivery_job % cannot be requeued — backing alert was purged', p_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.delivery_jobs
        SET state = 'queued', completed_at = NULL
        WHERE id = p_id
        RETURNING *
    )
    SELECT
        u.id, u.organization_id, u.alert_id, u.inbox_item_id, u.endpoint_id,
        u.state, u.created_at, u.completed_at, u.attempt_count,
        ai.title, ai.message, ai.severity, ai.state,
        ai.rule_kind, ai.active_since, ai.last_triggered_at,
        ai.source_subject_type, ai.source_subject_id,
        ar.id, ar.name
    FROM updated u
    JOIN notifications.alert_instances ai ON ai.id = u.alert_id
    JOIN notifications.alert_rules ar ON ar.id = ai.rule_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_upsert(
    p_organization_id         VARCHAR,
    p_channel_id              BIGINT DEFAULT NULL,
    p_name                    VARCHAR DEFAULT NULL,
    p_type                    VARCHAR DEFAULT NULL,
    p_config                  JSONB DEFAULT '{}'::jsonb,
    p_integration_endpoint_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id INTEGER,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    last_failure_at         TIMESTAMPTZ,
    last_failure_message    TEXT,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
    IF p_integration_endpoint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM notifications.integration_endpoints e
        WHERE e.id = p_integration_endpoint_id
          AND e.organization_id = p_organization_id
          AND e.provider = p_type
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'integration endpoint not found for channel';
    END IF;

    IF p_channel_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.channels
        SET
            integration_endpoint_id = p_integration_endpoint_id,
            name                    = COALESCE(p_name, channels.name),
            type                    = COALESCE(p_type, channels.type),
            config                  = COALESCE(p_config, channels.config),
            updated_at              = NOW()
        WHERE organization_id = p_organization_id
          AND id = p_channel_id
        RETURNING
            channels.id,
            channels.organization_id,
            channels.integration_endpoint_id,
            channels.name,
            channels.type,
            channels.config,
            channels.secret_version,
            channels.verification_status,
            channels.disabled_reason,
            channels.last_delivery_status,
            channels.last_delivery_at,
            channels.last_failure_at,
            channels.last_failure_message,
            channels.created_at,
            channels.updated_at;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO notifications.channels (
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_integration_endpoint_id,
        p_name,
        p_type,
        COALESCE(p_config, '{}'::jsonb),
        NOW()
    )
    RETURNING
        channels.id,
        channels.organization_id,
        channels.integration_endpoint_id,
        channels.name,
        channels.type,
        channels.config,
        channels.secret_version,
        channels.verification_status,
        channels.disabled_reason,
        channels.last_delivery_status,
        channels.last_delivery_at,
        channels.last_failure_at,
        channels.last_failure_message,
        channels.created_at,
        channels.updated_at;
END;
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
#variable_conflict use_column
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
#variable_conflict use_column
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

--------------DOWN
-- No-op: cannot revert to the ambiguous form without re-introducing the bug.
