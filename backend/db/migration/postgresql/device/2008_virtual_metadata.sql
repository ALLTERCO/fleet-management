--------------UP
CREATE TABLE device.virtual_metadata (
    organization_id VARCHAR(64) NOT NULL,
    host_shelly_id VARCHAR(64) NOT NULL,
    component_key VARCHAR(64) NOT NULL,
    glyph VARCHAR(128) DEFAULT NULL,
    color VARCHAR(32) DEFAULT NULL,
    gradient JSONB DEFAULT NULL,
    promoted_at TIMESTAMPTZ DEFAULT NULL,
    image_path VARCHAR(255) DEFAULT NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, host_shelly_id, component_key)
);

CREATE INDEX idx_virtual_metadata_promoted
    ON device.virtual_metadata(organization_id, host_shelly_id)
    WHERE promoted_at IS NOT NULL;

CREATE INDEX idx_virtual_metadata_host
    ON device.virtual_metadata(organization_id, host_shelly_id);
--------------DOWN
DROP TABLE IF EXISTS device.virtual_metadata;
