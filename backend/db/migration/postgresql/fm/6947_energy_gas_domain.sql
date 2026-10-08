--------------UP
-- The public classification contract has long admitted `gas`, and commodity
-- derivation already distinguishes it from water. These three persisted
-- classification surfaces must accept the same vocabulary or valid API writes
-- fail at the database boundary.
ALTER TABLE fm.energy_classification
    DROP CONSTRAINT IF EXISTS energy_classification_domain_chk;
ALTER TABLE fm.energy_classification
    ADD CONSTRAINT energy_classification_domain_chk CHECK (domain IN (
        'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'gas',
        'unspecified'
    ));

ALTER TABLE fm.energy_preset_classification
    DROP CONSTRAINT IF EXISTS energy_preset_classification_domain_chk;
ALTER TABLE fm.energy_preset_classification
    ADD CONSTRAINT energy_preset_classification_domain_chk CHECK (domain IN (
        'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'gas',
        'unspecified'
    ));

ALTER TABLE fm.logical_meter_point
    DROP CONSTRAINT IF EXISTS logical_meter_point_domain_chk;
ALTER TABLE fm.logical_meter_point
    ADD CONSTRAINT logical_meter_point_domain_chk CHECK (
        electrical_domain IS NULL OR electrical_domain IN (
            'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'gas',
            'unspecified'
        )
    );
--------------DOWN
-- A rollback cannot restore the narrower checks while gas rows exist.
-- Preserve those rows by returning them to the prior unspecified state.
UPDATE fm.energy_classification SET domain = 'unspecified' WHERE domain = 'gas';
UPDATE fm.energy_preset_classification SET domain = 'unspecified' WHERE domain = 'gas';
UPDATE fm.logical_meter_point
SET electrical_domain = 'unspecified'
WHERE electrical_domain = 'gas';

ALTER TABLE fm.energy_classification
    DROP CONSTRAINT IF EXISTS energy_classification_domain_chk;
ALTER TABLE fm.energy_classification
    ADD CONSTRAINT energy_classification_domain_chk CHECK (domain IN (
        'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'unspecified'
    ));

ALTER TABLE fm.energy_preset_classification
    DROP CONSTRAINT IF EXISTS energy_preset_classification_domain_chk;
ALTER TABLE fm.energy_preset_classification
    ADD CONSTRAINT energy_preset_classification_domain_chk CHECK (domain IN (
        'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'unspecified'
    ));

ALTER TABLE fm.logical_meter_point
    DROP CONSTRAINT IF EXISTS logical_meter_point_domain_chk;
ALTER TABLE fm.logical_meter_point
    ADD CONSTRAINT logical_meter_point_domain_chk CHECK (
        electrical_domain IS NULL OR electrical_domain IN (
            'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal',
            'unspecified'
        )
    );
