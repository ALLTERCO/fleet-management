-- Composite cross-rule lookup must see recently cleared/resolved instances
-- too. v1 filtered to active|acknowledged|cleared_unack which made AND
-- gates miss a leaf that fired and resolved inside the window. Per-leaf
-- windowSeconds in composite.ts already drops stale matches; SQL only
-- needs a coarse safety bound to avoid full-table scans.

--------------UP

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_states_for_rules(
    p_organization_id  TEXT,
    p_rule_ids         INTEGER[],
    p_subject_type     TEXT,
    p_subject_id       TEXT
)
    RETURNS TABLE (
        rule_id        INTEGER,
        state          VARCHAR,
        active_since   TIMESTAMPTZ
    )
    LANGUAGE sql
    STABLE
AS $$
    SELECT ai.rule_id, ai.state, ai.active_since
      FROM notifications.alert_instances ai
     WHERE ai.organization_id = p_organization_id
       AND ai.rule_id = ANY(p_rule_ids)
       AND ai.source_subject_type = p_subject_type
       AND ai.source_subject_id = p_subject_id
       AND ai.active_since > NOW() - INTERVAL '7 days';
$$;

--------------DOWN

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_states_for_rules(
    p_organization_id  TEXT,
    p_rule_ids         INTEGER[],
    p_subject_type     TEXT,
    p_subject_id       TEXT
)
    RETURNS TABLE (
        rule_id        INTEGER,
        state          VARCHAR,
        active_since   TIMESTAMPTZ
    )
    LANGUAGE sql
    STABLE
AS $$
    SELECT ai.rule_id, ai.state, ai.active_since
      FROM notifications.alert_instances ai
     WHERE ai.organization_id = p_organization_id
       AND ai.rule_id = ANY(p_rule_ids)
       AND ai.source_subject_type = p_subject_type
       AND ai.source_subject_id = p_subject_id
       AND ai.state IN ('active', 'acknowledged', 'cleared_unack');
$$;
