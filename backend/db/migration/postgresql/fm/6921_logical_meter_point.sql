--------------UP
-- Measurement points assigned to a logical meter. Each row is one
-- readable quantity on a channel/phase that already exists in
-- device_em (the classifier produced its tag/domain/phase). The logical
-- meter just groups these rows; this table holds the assignment plus the
-- auto facts copied at assignment time so a report can read the meter
-- without re-deriving them.
--
-- A physical point belongs to at most one primary logical meter — the
-- UNIQUE below enforces it. Virtual meters reference points indirectly
-- through their formula, not through rows here. Vocabularies (phase,
-- tag, electrical_domain) mirror energyClassifier.ts, their one home.

CREATE TABLE IF NOT EXISTS fm.logical_meter_point (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    logical_meter_id  BIGINT NOT NULL
        REFERENCES fm.logical_meter(id) ON DELETE CASCADE,
    device            INT NOT NULL,
    -- Display metadata, not identity — NULL for a history-only point the live
    -- snapshot could not label. Ownership is (device, channel, tag) below.
    component_key     VARCHAR(100) NULL,
    channel           SMALLINT NOT NULL DEFAULT 0,
    phase             VARCHAR(1) NOT NULL DEFAULT 'z',
    tag               VARCHAR(30) NOT NULL,
    electrical_domain VARCHAR(16) NULL,
    direction_hint    VARCHAR(16) NULL,
    CONSTRAINT logical_meter_point_phase_chk CHECK (phase IN (
        'a', 'b', 'c', 'z'
    )),
    CONSTRAINT logical_meter_point_channel_chk CHECK (
        channel >= 0 AND channel <= 31
    ),
    CONSTRAINT logical_meter_point_tag_chk CHECK (tag IN (
        'power', 'apparent_power', 'reactive_power', 'voltage', 'current',
        'frequency', 'power_factor', 'total_power', 'total_apparent_power',
        'total_current', 'neutral_current', 'total_act_energy',
        'total_act_ret_energy', 'percentage', 'temperature_c',
        'temperature_f', 'volume_l', 'volume_m3', 'volume_storage_l',
        'volume_flow_m3h', 'thermal_energy_kwh'
    )),
    CONSTRAINT logical_meter_point_domain_chk CHECK (
        electrical_domain IS NULL OR electrical_domain IN (
            'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus', 'thermal', 'unspecified'
        )
    ),
    CONSTRAINT logical_meter_point_direction_chk CHECK (
        direction_hint IS NULL OR direction_hint IN (
            'import', 'export', 'charge', 'discharge'
        )
    ),
    -- One owned point → one logical meter. Ownership is the (device, channel,
    -- tag) grain: channel energy is phase-summed and the energy query can't tell
    -- components or phases on one channel apart, so they never split across
    -- meters. component_key/phase/electrical_domain are kept as display metadata
    -- but are NOT part of identity. This is the DB backstop for the same rule
    -- meterOwnership.meterPointKey enforces in code — it stops a race or direct
    -- SQL from double-owning a queryable point.
    CONSTRAINT logical_meter_point_unique UNIQUE (
        device, channel, tag
    )
);

CREATE INDEX IF NOT EXISTS logical_meter_point_meter_idx
    ON fm.logical_meter_point (logical_meter_id);
CREATE INDEX IF NOT EXISTS logical_meter_point_device_idx
    ON fm.logical_meter_point (device);

COMMENT ON TABLE fm.logical_meter_point IS
    'Channel/phase points assigned to a logical meter — the grouping rows.';
--------------DOWN
DROP TABLE IF EXISTS fm.logical_meter_point;
