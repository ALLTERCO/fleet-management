--------------UP
-- Materialized and derived custom-device roles need their own typed history.
-- device.status is intentionally numeric-only and cannot represent boolean,
-- string, event, or JSON role values.
CREATE TABLE device.virtual_device_projected_sample (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY,
    ts                     TIMESTAMPTZ NOT NULL,
    organization_id        VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    virtual_device_list_id INTEGER NOT NULL REFERENCES device.virtual_device(device_list_id) ON DELETE CASCADE,
    binding_id             UUID NOT NULL REFERENCES device.virtual_device_binding(id) ON DELETE CASCADE,
    role_key               VARCHAR(80) NOT NULL,
    series                 VARCHAR(24) NOT NULL,
    field                  VARCHAR(80) NOT NULL,
    value                  JSONB NOT NULL,
    prev_value             JSONB,
    source_device_list_id  INTEGER REFERENCES device.list(id) ON DELETE SET NULL,
    source_external_id     VARCHAR(120) NOT NULL,
    source_component_key   VARCHAR(80) NOT NULL,
    source_ts              TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT virtual_device_projected_sample_pk PRIMARY KEY (id, ts),
    CONSTRAINT virtual_device_projected_sample_role_key_valid CHECK (
        role_key ~ '^[a-z][a-z0-9_]*$'
    ),
    CONSTRAINT virtual_device_projected_sample_series_valid CHECK (
        series IN ('status', 'sensor_numeric', 'sensor_event', 'energy')
    ),
    CONSTRAINT virtual_device_projected_sample_component_key_valid CHECK (
        source_component_key ~ '^[a-z][a-z0-9_]*:[0-9]+$'
    ),
    CONSTRAINT virtual_device_projected_sample_virtual_org_fk FOREIGN KEY (
        virtual_device_list_id,
        organization_id
    ) REFERENCES device.virtual_device(device_list_id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT virtual_device_projected_sample_source_org_fk FOREIGN KEY (
        source_device_list_id,
        organization_id
    ) REFERENCES device.list(id, organization_id)
        ON DELETE SET NULL (source_device_list_id),
    CONSTRAINT virtual_device_projected_sample_idempotency UNIQUE (
        binding_id,
        source_ts,
        field,
        ts
    )
);

SELECT create_hypertable(
    'device.virtual_device_projected_sample',
    'ts',
    chunk_time_interval => INTERVAL '30 days'
);

ALTER TABLE device.virtual_device_projected_sample SET (
    timescaledb.compress = TRUE,
    timescaledb.compress_segmentby = 'virtual_device_list_id, binding_id, role_key, series, field',
    timescaledb.compress_orderby = 'ts'
);

SELECT add_compression_policy(
    'device.virtual_device_projected_sample',
    compress_after => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_virtual_device_projected_sample_window
    ON device.virtual_device_projected_sample (
        organization_id,
        virtual_device_list_id,
        role_key,
        ts
    );

CREATE INDEX IF NOT EXISTS idx_virtual_device_projected_sample_binding_window
    ON device.virtual_device_projected_sample (binding_id, ts);

--------------DOWN
DROP TABLE IF EXISTS device.virtual_device_projected_sample;
