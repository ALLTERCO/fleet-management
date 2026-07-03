--------------UP
-- Keep the sweep org selector in lockstep with RuleSweep.SWEEP_KINDS.
-- Energy consumption is also sweep-driven; no device event can evaluate a
-- persisted time window.

CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.kind IN (
          'heartbeat',
          'energy_consumption_threshold',
          'rate_of_change',
          'stuck_sensor'
      );
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.kind IN ('heartbeat', 'rate_of_change', 'stuck_sensor');
$$;
