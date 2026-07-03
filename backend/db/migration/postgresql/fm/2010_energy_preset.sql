--------------UP
-- Reusable classification bundles. A preset captures the per-component
-- (tag, domain) decisions an operator made for one device of a given
-- "signature" (model + script layout fingerprint); ApplyPreset replays
-- those onto a second device that matches the same signature.

CREATE TABLE IF NOT EXISTS fm.energy_preset (
    preset_id    BIGSERIAL PRIMARY KEY,
    name         VARCHAR(200) NOT NULL,
    signature    VARCHAR(200) NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by   VARCHAR(200) NULL
);

CREATE INDEX IF NOT EXISTS energy_preset_signature_idx
    ON fm.energy_preset (signature);

CREATE TABLE IF NOT EXISTS fm.energy_preset_classification (
    preset_id      BIGINT NOT NULL REFERENCES fm.energy_preset(preset_id)
                       ON DELETE CASCADE,
    component_key  VARCHAR(100) NOT NULL,
    tag            VARCHAR(30) NOT NULL,
    domain         VARCHAR(16) NOT NULL,
    channel        SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (preset_id, component_key),
    CONSTRAINT energy_preset_classification_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f'
    )),
    CONSTRAINT energy_preset_classification_domain_chk CHECK (domain IN (
        'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'unspecified'
    )),
    CONSTRAINT energy_preset_classification_channel_chk CHECK (
        channel >= 0 AND channel <= 31
    )
);

COMMENT ON TABLE fm.energy_preset IS
    'Named classification bundle reusable across devices of a matching signature.';
COMMENT ON COLUMN fm.energy_preset.signature IS
    'Device model + script-layout fingerprint — same signature = same preset applies cleanly.';
--------------DOWN
DROP TABLE IF EXISTS fm.energy_preset_classification;
DROP TABLE IF EXISTS fm.energy_preset;
