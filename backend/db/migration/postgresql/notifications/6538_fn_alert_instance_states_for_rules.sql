-- Per-rule active state lookup for composite rule evaluation.

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
       AND ai.state IN ('active', 'acknowledged', 'cleared_unack');
$$;

--------------DOWN

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_states_for_rules(
    TEXT, INTEGER[], TEXT, TEXT
);
