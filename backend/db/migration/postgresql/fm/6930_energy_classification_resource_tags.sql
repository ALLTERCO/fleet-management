--------------UP
-- Allow resource-utility tags (gas/water/heat) on energy classifications.
-- Origin 2000 shipped the tag CHECK without them; an upgraded DB already has the
-- table, so widen the named constraint instead of editing 2000 in place. Adding
-- allowed values is a superset, so existing rows still validate.
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
--------------DOWN
ALTER TABLE fm.energy_classification
    DROP CONSTRAINT IF EXISTS energy_classification_tag_chk;
ALTER TABLE fm.energy_classification
    ADD CONSTRAINT energy_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f'
    ));
