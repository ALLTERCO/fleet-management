--------------UP
SET search_path TO public;

-- A BLU device now owns its relayed readings, so a gateway-subject alert on one would never resolve.
-- Resolving it lets the BLU device path reopen it under the BLU device if it still holds.
CREATE OR REPLACE FUNCTION notifications.fn_alert_move_blu_gateway_subjects()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_moved INTEGER;
BEGIN
    WITH owned AS (
        SELECT DISTINCT
               bd.organization_id,
               bt.shelly_device_list_id AS gateway_id,
               split_part(c->>'componentKey', ':', 1) AS component_type,
               split_part(c->>'componentKey', ':', 2) AS component_id
          FROM device.blu_device bd
          JOIN device.blu_transport bt
            ON bt.blu_device_list_id = bd.device_list_id
           AND bt.organization_id = bd.organization_id
           AND bt.mode = 'bthome_gateway'
           AND bt.enabled IS TRUE
          CROSS JOIN LATERAL jsonb_array_elements(
              COALESCE(bd.source_components_json, '[]'::jsonb)
          ) c
         WHERE bd.deleted_at IS NULL
           AND bt.shelly_device_list_id IS NOT NULL
           AND c->>'componentKey' ~ '^[a-z]+:[0-9]+$'
    ),
    moved AS (
        UPDATE notifications.alert_instances ai
           SET state = 'resolved',
               resolved_at = NOW()
         WHERE ai.state IN ('active', 'acknowledged')
           AND EXISTS (
               SELECT 1
                 FROM owned o
                WHERE o.organization_id = ai.organization_id
                  AND (
                      starts_with(
                          ai.fingerprint,
                          'rule:' || ai.rule_id || ':device:' || o.gateway_id
                              || ':' || o.component_type || ':'
                              || o.component_id || '.'
                      )
                      OR ai.fingerprint =
                          'rule:' || ai.rule_id || ':entity:' || o.gateway_id
                              || '_' || o.component_id || ':' || o.component_type
                  )
           )
        RETURNING ai.id
    )
    INSERT INTO notifications.alert_transitions (alert_id, action, data)
    SELECT id, 'resolved', jsonb_build_object('reason', 'moved_to_bluetooth_device')
      FROM moved;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RETURN v_moved;
END;
$$;

SELECT notifications.fn_alert_move_blu_gateway_subjects();

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS notifications.fn_alert_move_blu_gateway_subjects();
