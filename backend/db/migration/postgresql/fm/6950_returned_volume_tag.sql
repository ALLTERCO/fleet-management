--------------UP
-- A returned/injected gas counter is a distinct cumulative measurement, not a
-- sign guessed from the import counter. Admit its canonical tag anywhere an
-- operator classification can be persisted or assigned to a logical meter.

ALTER TABLE fm.energy_classification
    DROP CONSTRAINT IF EXISTS energy_classification_tag_chk;
ALTER TABLE fm.energy_classification
    ADD CONSTRAINT energy_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_returned_m3',
        'volume_storage_l', 'volume_flow_m3h', 'thermal_energy_kwh'
    ));

ALTER TABLE fm.energy_preset_classification
    DROP CONSTRAINT IF EXISTS energy_preset_classification_tag_chk;
ALTER TABLE fm.energy_preset_classification
    ADD CONSTRAINT energy_preset_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_returned_m3',
        'volume_storage_l', 'volume_flow_m3h', 'thermal_energy_kwh'
    ));

ALTER TABLE fm.logical_meter_point
    DROP CONSTRAINT IF EXISTS logical_meter_point_tag_chk;
ALTER TABLE fm.logical_meter_point
    ADD CONSTRAINT logical_meter_point_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_returned_m3',
        'volume_storage_l', 'volume_flow_m3h', 'thermal_energy_kwh'
    ));
--------------DOWN
-- Refuse to narrow the constraints while returned-volume classifications or
-- assignments still exist. Operators must explicitly remove/reclassify them;
-- rollback must not silently turn injection into consumption.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM fm.energy_classification
        WHERE tag = 'volume_returned_m3'
    ) OR EXISTS (
        SELECT 1 FROM fm.energy_preset_classification
        WHERE tag = 'volume_returned_m3'
    ) OR EXISTS (
        SELECT 1 FROM fm.logical_meter_point
        WHERE tag = 'volume_returned_m3'
    ) THEN
        RAISE EXCEPTION
            'cannot roll back returned-volume tag while persisted rows use it';
    END IF;
END;
$$;

ALTER TABLE fm.energy_classification
    DROP CONSTRAINT IF EXISTS energy_classification_tag_chk;
ALTER TABLE fm.energy_classification
    ADD CONSTRAINT energy_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_storage_l',
        'volume_flow_m3h', 'thermal_energy_kwh'
    ));

ALTER TABLE fm.energy_preset_classification
    DROP CONSTRAINT IF EXISTS energy_preset_classification_tag_chk;
ALTER TABLE fm.energy_preset_classification
    ADD CONSTRAINT energy_preset_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_storage_l',
        'volume_flow_m3h', 'thermal_energy_kwh'
    ));

ALTER TABLE fm.logical_meter_point
    DROP CONSTRAINT IF EXISTS logical_meter_point_tag_chk;
ALTER TABLE fm.logical_meter_point
    ADD CONSTRAINT logical_meter_point_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_storage_l',
        'volume_flow_m3h', 'thermal_energy_kwh'
    ));
