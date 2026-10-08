--------------UP
SET search_path TO device_em, public;

CREATE INDEX IF NOT EXISTS energy_15min_battery_report_idx
    ON device_em.energy_15min (device, tag, bucket DESC)
    WHERE electrical_source = 'dc_battery'
      AND tag IN ('soc', 'soh', 'cycles', 'charge_ah', 'discharge_ah');

--------------DOWN
DROP INDEX IF EXISTS device_em.energy_15min_battery_report_idx;
