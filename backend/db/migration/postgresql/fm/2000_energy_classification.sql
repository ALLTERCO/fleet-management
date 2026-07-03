--------------UP
-- Operator overrides for the energy classifier. PRIMARY KEY on
-- (device, component_key) means at most one classification per
-- component; the classifier reads this BEFORE consulting any
-- code-side table. Empty table = pure heuristic operation.

CREATE TABLE IF NOT EXISTS fm.energy_classification (
    device              INT NOT NULL,
    component_key       VARCHAR(100) NOT NULL,
    tag                 VARCHAR(30) NOT NULL,
    domain              VARCHAR(16) NOT NULL,
    channel             SMALLINT NOT NULL DEFAULT 0,
    classifier_source   VARCHAR(16) NOT NULL DEFAULT 'table',
    declared_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    declared_by         VARCHAR(200) NULL,
    PRIMARY KEY (device, component_key),
    CONSTRAINT energy_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f'
    )),
    CONSTRAINT energy_classification_domain_chk CHECK (domain IN (
        'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'unspecified'
    )),
    CONSTRAINT energy_classification_channel_chk CHECK (
        channel >= 0 AND channel <= 31
    )
);

CREATE INDEX IF NOT EXISTS energy_classification_device_idx
    ON fm.energy_classification (device);

COMMENT ON TABLE fm.energy_classification IS
    'Operator overrides for energy classifier — tier 1, highest priority.';
COMMENT ON COLUMN fm.energy_classification.declared_by IS
    'Operator user identifier (email or login) responsible for this row.';
--------------DOWN
DROP TABLE IF EXISTS fm.energy_classification;
