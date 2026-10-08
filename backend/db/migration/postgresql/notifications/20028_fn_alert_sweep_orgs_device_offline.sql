--------------UP
-- device_offline is absence-driven. A quiet organization produces no event
-- that could warm the alert-rule cache, so it must be selected by the periodic
-- sweep just like heartbeat and the other time-driven kinds.
CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.deleted_at IS NULL
      AND r.kind IN (
          'device_offline',
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
      AND r.deleted_at IS NULL
      AND r.kind IN (
          'heartbeat',
          'energy_consumption_threshold',
          'rate_of_change',
          'stuck_sensor'
      );
$$;
