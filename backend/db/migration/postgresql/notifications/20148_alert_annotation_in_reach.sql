--------------UP
SET search_path TO public;

-- An annotation is edited or deleted by its own id, so a scoped writer needs
-- to know whether the alert it belongs to is in reach before the write.
CREATE OR REPLACE FUNCTION notifications.fn_alert_annotation_in_reach(
    p_organization_id    VARCHAR,
    p_id                 BIGINT,
    p_reach_device_ids   VARCHAR[],
    p_reach_location_ids INTEGER[],
    p_reach_group_ids    INTEGER[]
)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM notifications.alert_annotations a
          JOIN notifications.alert_instances ai
            ON ai.organization_id = a.organization_id
           AND ai.id = a.alert_instance_id
          LEFT JOIN device.list d
            ON d.organization_id = ai.organization_id
           AND d.id = ai.source_device_id
         WHERE a.organization_id = p_organization_id
           AND a.id = p_id
           AND notifications.fn_alert_instance_in_reach(
                   ai.source_subject_type, ai.source_subject_id, d.external_id,
                   ai.source_location_id, p_reach_device_ids,
                   p_reach_location_ids, p_reach_group_ids
               )
    );
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_in_reach(
    VARCHAR, BIGINT, VARCHAR[], INTEGER[], INTEGER[]
);
