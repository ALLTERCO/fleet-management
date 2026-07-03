--------------UP

CREATE TABLE IF NOT EXISTS device.device_serves (
    id BIGSERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    source_device_id TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('device', 'group', 'location')),
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'serves:serves',
    weight NUMERIC CHECK (weight IS NULL OR weight > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, source_device_id, target_kind, target_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_device_serves_source
    ON device.device_serves (organization_id, source_device_id);

CREATE INDEX IF NOT EXISTS idx_device_serves_target
    ON device.device_serves (organization_id, target_kind, target_id);

CREATE TABLE IF NOT EXISTS organization.group_serves (
    id BIGSERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    source_group_id INTEGER NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('group', 'location')),
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'serves:serves',
    weight NUMERIC CHECK (weight IS NULL OR weight > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, source_group_id, target_kind, target_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_group_serves_source
    ON organization.group_serves (organization_id, source_group_id);

CREATE INDEX IF NOT EXISTS idx_group_serves_target
    ON organization.group_serves (organization_id, target_kind, target_id);

--------------DOWN

DROP TABLE IF EXISTS organization.group_serves;
DROP TABLE IF EXISTS device.device_serves;
