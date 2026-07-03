--------------UP
-- Same widening for preset classifications: allow gas/water/heat tags. Origin
-- 2010 shipped the CHECK without them and the table predates this change on
-- upgraded DBs, so replace the named constraint rather than edit 2010 in place.
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
--------------DOWN
ALTER TABLE fm.energy_preset_classification
    DROP CONSTRAINT IF EXISTS energy_preset_classification_tag_chk;
ALTER TABLE fm.energy_preset_classification
    ADD CONSTRAINT energy_preset_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f'
    ));
