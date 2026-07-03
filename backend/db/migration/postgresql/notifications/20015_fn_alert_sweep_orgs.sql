--------------UP
-- The RuleSweep is timer-driven, so it cannot rely on the engine's
-- event-warmed per-org rule cache — a quiet org whose only rule is a heartbeat
-- deadman would never load. This returns every org that has at least one
-- enabled time/absence rule; the sweep then loads each via the normal cached
-- per-org loader. Kept in lockstep with SWEEP_KINDS in RuleSweep.ts.

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
DROP FUNCTION IF EXISTS notifications.fn_alert_sweep_orgs();
