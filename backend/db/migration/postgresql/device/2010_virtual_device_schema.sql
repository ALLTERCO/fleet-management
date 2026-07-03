--------------UP
CREATE TABLE device.virtual_device_profile (
    id              UUID PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    key             VARCHAR(80) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    roles_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT virtual_device_profile_version_positive CHECK (version >= 1),
    CONSTRAINT virtual_device_profile_key_valid CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

ALTER TABLE device.virtual_device_profile
    ADD CONSTRAINT virtual_device_profile_id_org_unique UNIQUE (
        id,
        organization_id
    );

CREATE UNIQUE INDEX idx_virtual_device_profile_org_key_version
    ON device.virtual_device_profile (organization_id, key, version)
    WHERE deleted_at IS NULL;

CREATE TABLE device.virtual_device (
    device_list_id  INTEGER PRIMARY KEY REFERENCES device.list(id) ON DELETE CASCADE,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    kind            VARCHAR(24) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    type_key        VARCHAR(80) NOT NULL,
    category_key    VARCHAR(80),
    profile_id      UUID,
    image_asset_id  VARCHAR(255),
    location_id     INTEGER,
    visual_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    revision        BIGINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT virtual_device_kind_valid CHECK (
        kind IN ('extracted', 'composed', 'connector')
    ),
    CONSTRAINT virtual_device_revision_positive CHECK (revision >= 1),
    CONSTRAINT virtual_device_type_key_valid CHECK (type_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT virtual_device_category_key_valid CHECK (
        category_key IS NULL OR category_key ~ '^[a-z][a-z0-9_]*$'
    ),
    CONSTRAINT virtual_device_list_org_fk FOREIGN KEY (device_list_id, organization_id)
        REFERENCES device.list(id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT virtual_device_profile_org_fk FOREIGN KEY (profile_id, organization_id)
        REFERENCES device.virtual_device_profile(id, organization_id)
        ON DELETE SET NULL (profile_id)
);

ALTER TABLE device.virtual_device
    ADD CONSTRAINT virtual_device_list_org_unique UNIQUE (
        device_list_id,
        organization_id
    );

CREATE TABLE device.virtual_device_binding (
    id                      UUID PRIMARY KEY,
    virtual_device_list_id  INTEGER NOT NULL REFERENCES device.virtual_device(device_list_id) ON DELETE CASCADE,
    organization_id         VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    role_key                VARCHAR(80) NOT NULL,
    source_device_list_id   INTEGER NOT NULL REFERENCES device.list(id) ON DELETE RESTRICT,
    source_component_key    VARCHAR(80) NOT NULL,
    source_dynamic_category VARCHAR(24),
    mode                    VARCHAR(24) NOT NULL DEFAULT 'linked',
    transform_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
    effective_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to            TIMESTAMPTZ,
    created_by              VARCHAR(120),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_by              VARCHAR(120),
    retired_reason          VARCHAR(500),
    CONSTRAINT virtual_device_binding_role_key_valid CHECK (role_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT virtual_device_binding_component_key_valid CHECK (
        source_component_key ~ '^[a-z][a-z0-9_]*:[0-9]+$'
    ),
    CONSTRAINT virtual_device_binding_dynamic_category_valid CHECK (
        source_dynamic_category IS NULL OR
        source_dynamic_category IN ('Virtual', 'BTHome', 'LNM')
    ),
    CONSTRAINT virtual_device_binding_mode_valid CHECK (
        mode IN ('linked', 'materialized', 'derived', 'live_only')
    ),
    CONSTRAINT virtual_device_binding_period_valid CHECK (
        effective_to IS NULL OR effective_to > effective_from
    ),
    CONSTRAINT virtual_device_binding_parent_org_fk FOREIGN KEY (
        virtual_device_list_id,
        organization_id
    ) REFERENCES device.virtual_device(device_list_id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT virtual_device_binding_source_org_fk FOREIGN KEY (
        source_device_list_id,
        organization_id
    ) REFERENCES device.list(id, organization_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_virtual_device_binding_one_active_role
    ON device.virtual_device_binding (virtual_device_list_id, role_key)
    WHERE effective_to IS NULL;

CREATE INDEX idx_virtual_device_binding_source
    ON device.virtual_device_binding (source_device_list_id, source_component_key);

CREATE OR REPLACE FUNCTION device.fn_virtual_device_binding_no_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtext('device.virtual_device_binding'),
        hashtext(NEW.virtual_device_list_id::text || ':' || NEW.role_key)
    );

    IF EXISTS (
        SELECT 1
        FROM device.virtual_device_binding existing
        WHERE existing.virtual_device_list_id = NEW.virtual_device_list_id
          AND existing.role_key = NEW.role_key
          AND existing.id <> NEW.id
          AND tstzrange(
              existing.effective_from,
              COALESCE(existing.effective_to, 'infinity'::timestamptz),
              '[)'
          ) && tstzrange(
              NEW.effective_from,
              COALESCE(NEW.effective_to, 'infinity'::timestamptz),
              '[)'
          )
    ) THEN
        RAISE EXCEPTION 'virtual device binding interval overlaps for role %', NEW.role_key
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_virtual_device_binding_no_overlap
BEFORE INSERT OR UPDATE OF virtual_device_list_id, role_key, effective_from, effective_to
ON device.virtual_device_binding
FOR EACH ROW
EXECUTE FUNCTION device.fn_virtual_device_binding_no_overlap();

CREATE TABLE device.virtual_device_binding_event (
    id                     UUID PRIMARY KEY,
    binding_id             UUID REFERENCES device.virtual_device_binding(id) ON DELETE SET NULL,
    virtual_device_list_id INTEGER NOT NULL REFERENCES device.virtual_device(device_list_id) ON DELETE CASCADE,
    event_type             VARCHAR(24) NOT NULL,
    old_source_json        JSONB,
    new_source_json        JSONB,
    actor_id               VARCHAR(120),
    reason                 VARCHAR(500),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT virtual_device_binding_event_type_valid CHECK (
        event_type IN ('create', 'replace', 'retire')
    )
);

CREATE TABLE device.blu_device (
    device_list_id     INTEGER PRIMARY KEY REFERENCES device.list(id) ON DELETE CASCADE,
    organization_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    stable_id          VARCHAR(120) NOT NULL,
    ble_address        VARCHAR(32),
    product_name       VARCHAR(120),
    model_id           VARCHAR(120),
    encryption_key_ref VARCHAR(255),
    source_components_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    capability         VARCHAR(32) NOT NULL DEFAULT 'unknown',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ,
    deleted_at         TIMESTAMPTZ,
    CONSTRAINT blu_device_capability_valid CHECK (
        capability IN ('telemetry_only', 'event_only', 'controllable', 'unknown')
    ),
    CONSTRAINT blu_device_list_org_fk FOREIGN KEY (device_list_id, organization_id)
        REFERENCES device.list(id, organization_id)
        ON DELETE CASCADE
);

ALTER TABLE device.blu_device
    ADD CONSTRAINT blu_device_list_org_unique UNIQUE (
        device_list_id,
        organization_id
    );

CREATE UNIQUE INDEX idx_blu_device_org_stable
    ON device.blu_device (organization_id, stable_id)
    WHERE deleted_at IS NULL;

CREATE TABLE device.blu_transport (
    id                         UUID PRIMARY KEY,
    blu_device_list_id         INTEGER NOT NULL REFERENCES device.blu_device(device_list_id) ON DELETE CASCADE,
    organization_id            VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    mode                       VARCHAR(32) NOT NULL,
    is_primary                 BOOLEAN NOT NULL DEFAULT FALSE,
    can_write                  BOOLEAN NOT NULL DEFAULT FALSE,
    shelly_device_list_id      INTEGER,
    host_adapter_id            VARCHAR(120),
    assistant_device_list_id   INTEGER,
    serial_port_ref            VARCHAR(255),
    enabled                    BOOLEAN NOT NULL DEFAULT TRUE,
    key_distributed_at         TIMESTAMPTZ,
    last_seen_at               TIMESTAMPTZ,
    last_rssi                  INTEGER,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ,
    CONSTRAINT blu_transport_mode_valid CHECK (
        mode IN ('bthome_gateway', 'blu_assistant_ws', 'blu_assistant_serial', 'host_bluetooth')
    ),
    CONSTRAINT blu_transport_blu_org_fk FOREIGN KEY (
        blu_device_list_id,
        organization_id
    ) REFERENCES device.blu_device(device_list_id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT blu_transport_shelly_org_fk FOREIGN KEY (
        shelly_device_list_id,
        organization_id
    ) REFERENCES device.list(id, organization_id)
        ON DELETE SET NULL (shelly_device_list_id),
    CONSTRAINT blu_transport_assistant_org_fk FOREIGN KEY (
        assistant_device_list_id,
        organization_id
    ) REFERENCES device.list(id, organization_id)
        ON DELETE SET NULL (assistant_device_list_id)
);

CREATE UNIQUE INDEX idx_blu_transport_one_primary
    ON device.blu_transport (blu_device_list_id)
    WHERE is_primary IS TRUE AND enabled IS TRUE;

CREATE INDEX idx_blu_transport_shelly
    ON device.blu_transport (shelly_device_list_id)
    WHERE shelly_device_list_id IS NOT NULL;

CREATE TABLE device.blu_key_event (
    id                 UUID PRIMARY KEY,
    blu_device_list_id INTEGER NOT NULL REFERENCES device.blu_device(device_list_id) ON DELETE CASCADE,
    organization_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    event_type         VARCHAR(32) NOT NULL,
    key_ref            VARCHAR(255),
    transport_id       UUID REFERENCES device.blu_transport(id) ON DELETE SET NULL,
    actor_id           VARCHAR(120),
    reason             VARCHAR(500),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT blu_key_event_type_valid CHECK (
        event_type IN ('promote', 'set_ref', 'clear_ref', 'distribute', 'rotate_requested', 'revoke')
    ),
    CONSTRAINT blu_key_event_device_org_fk FOREIGN KEY (
        blu_device_list_id,
        organization_id
    ) REFERENCES device.blu_device(device_list_id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_blu_key_event_device_time
    ON device.blu_key_event (blu_device_list_id, created_at DESC);

CREATE TABLE device.blu_sample_provenance (
    id                  BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    blu_device_list_id  INTEGER NOT NULL REFERENCES device.blu_device(device_list_id) ON DELETE CASCADE,
    component_key       VARCHAR(80) NOT NULL,
    transport_id        UUID REFERENCES device.blu_transport(id) ON DELETE SET NULL,
    rssi                INTEGER,
    received_at         TIMESTAMPTZ NOT NULL,
    source_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT blu_sample_component_key_valid CHECK (
        component_key ~ '^[a-z][a-z0-9_]*:[0-9]+$'
    )
);

CREATE INDEX idx_blu_sample_provenance_device_time
    ON device.blu_sample_provenance (blu_device_list_id, received_at DESC);
--------------DOWN
DROP TABLE IF EXISTS device.blu_sample_provenance;
DROP TABLE IF EXISTS device.blu_key_event;
DROP TABLE IF EXISTS device.blu_transport;
DROP TABLE IF EXISTS device.blu_device;
DROP TABLE IF EXISTS device.virtual_device_binding_event;
DROP TRIGGER IF EXISTS trg_virtual_device_binding_no_overlap
    ON device.virtual_device_binding;
DROP FUNCTION IF EXISTS device.fn_virtual_device_binding_no_overlap();
DROP TABLE IF EXISTS device.virtual_device_binding;
DROP TABLE IF EXISTS device.virtual_device;
DROP TABLE IF EXISTS device.virtual_device_profile;
