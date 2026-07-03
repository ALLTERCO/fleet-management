--------------UP
ALTER TABLE device.virtual_device_binding_event
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
    ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_device_binding_event_idempotency
    ON device.virtual_device_binding_event (
        virtual_device_list_id,
        idempotency_key
    )
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE device.virtual_device_sample_source (
    id                     BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    ts                     TIMESTAMPTZ NOT NULL,
    organization_id        VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    virtual_device_list_id INTEGER NOT NULL REFERENCES device.virtual_device(device_list_id) ON DELETE CASCADE,
    binding_id             UUID NOT NULL REFERENCES device.virtual_device_binding(id) ON DELETE CASCADE,
    role_key               VARCHAR(80) NOT NULL,
    source_device_list_id  INTEGER REFERENCES device.list(id) ON DELETE SET NULL,
    source_external_id     VARCHAR(120) NOT NULL,
    source_component_key   VARCHAR(80) NOT NULL,
    source_ts              TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT virtual_device_sample_source_role_key_valid CHECK (
        role_key ~ '^[a-z][a-z0-9_]*$'
    ),
    CONSTRAINT virtual_device_sample_source_component_key_valid CHECK (
        source_component_key ~ '^[a-z][a-z0-9_]*:[0-9]+$'
    ),
    CONSTRAINT virtual_device_sample_source_virtual_org_fk FOREIGN KEY (
        virtual_device_list_id,
        organization_id
    ) REFERENCES device.virtual_device(device_list_id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT virtual_device_sample_source_source_org_fk FOREIGN KEY (
        source_device_list_id,
        organization_id
    ) REFERENCES device.list(id, organization_id)
        ON DELETE SET NULL (source_device_list_id)
);

CREATE INDEX idx_virtual_device_sample_source_window
    ON device.virtual_device_sample_source (
        virtual_device_list_id,
        role_key,
        ts DESC
    );

CREATE INDEX idx_virtual_device_sample_source_binding
    ON device.virtual_device_sample_source (binding_id, ts DESC);
--------------DOWN
DROP TABLE IF EXISTS device.virtual_device_sample_source;
DROP INDEX IF EXISTS device.idx_virtual_device_binding_event_idempotency;
ALTER TABLE device.virtual_device_binding_event
    DROP COLUMN IF EXISTS request_hash,
    DROP COLUMN IF EXISTS idempotency_key;
