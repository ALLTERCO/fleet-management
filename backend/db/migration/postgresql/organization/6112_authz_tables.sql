--------------UP
-- Personas + user groups + assignments. tenant_id mirrors organization.profile.id (Zitadel org id).

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS personas (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         VARCHAR(120) NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    key               text NOT NULL,
    name              text NOT NULL,
    description       text,
    is_system_managed boolean NOT NULL DEFAULT false,
    statements        jsonb NOT NULL,
    version           int NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- NULL tenant_id is allowed for system personas; partial unique indexes split tenant vs system.
CREATE UNIQUE INDEX IF NOT EXISTS personas_tenant_key_uidx
    ON personas (tenant_id, key) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS personas_system_key_uidx
    ON personas (key) WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS personas_tenant_idx
    ON personas (tenant_id) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_groups (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name            text NOT NULL,
    description     text,
    parent_group_id uuid NULL REFERENCES user_groups(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_groups_unique_name UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS user_groups_tenant_idx ON user_groups (tenant_id);

CREATE TABLE IF NOT EXISTS user_group_memberships (
    group_id   uuid NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id    text NOT NULL,
    added_at   timestamptz NOT NULL DEFAULT now(),
    added_by   text NOT NULL,
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS user_group_memberships_user_idx
    ON user_group_memberships (user_id);

CREATE TABLE IF NOT EXISTS assignments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'user_group')),
    subject_id   text NOT NULL,
    persona_id   uuid NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,
    scope        jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_subject_idx
    ON assignments (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS assignments_persona_idx ON assignments (persona_id);
CREATE INDEX IF NOT EXISTS assignments_scope_device_ids_idx
    ON assignments USING GIN ((scope -> 'device_ids'))
    WHERE scope ? 'device_ids';
CREATE INDEX IF NOT EXISTS assignments_scope_location_ids_idx
    ON assignments USING GIN ((scope -> 'location_ids'))
    WHERE scope ? 'location_ids';
CREATE INDEX IF NOT EXISTS assignments_scope_tags_idx
    ON assignments USING GIN ((scope -> 'device_tags'))
    WHERE scope ? 'device_tags';

-- Read-path SoT is Redis; this column is the durable shadow for Redis recovery.
ALTER TABLE organization.profile
    ADD COLUMN IF NOT EXISTS authz_version bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS authz_audit (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    actor_id    text NOT NULL,
    action      text NOT NULL,
    target_type text NOT NULL,
    target_id   text NOT NULL,
    payload     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authz_audit_tenant_idx
    ON authz_audit (tenant_id, created_at DESC);

INSERT INTO personas (tenant_id, key, name, description, is_system_managed, statements)
VALUES
    (NULL, 'admin', 'Admin', 'Full administrative access', true,
     '[{"actions":["*"],"resource_types":["*"]}]'::jsonb),
    (NULL, 'installer', 'Installer',
     'Read devices and admit/deny waiting room', true,
     '[{"actions":["device:read","waiting_room:create","waiting_room:delete"],"resource_types":["device","waiting_room"]}]'::jsonb),
    (NULL, 'viewer', 'Viewer', 'Read-only access to devices', true,
     '[{"actions":["device:read"],"resource_types":["device"]}]'::jsonb),
    (NULL, 'operator', 'Operator', 'Read and control devices', true,
     '[{"actions":["device:read","device:write"],"resource_types":["device"]}]'::jsonb)
ON CONFLICT (key) WHERE tenant_id IS NULL
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    statements = EXCLUDED.statements,
    version = personas.version + 1,
    updated_at = now();

CREATE OR REPLACE FUNCTION personas_set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personas_updated_at ON personas;
CREATE TRIGGER personas_updated_at
    BEFORE UPDATE ON personas
    FOR EACH ROW EXECUTE FUNCTION personas_set_updated_at();

CREATE OR REPLACE FUNCTION bump_authz_version() RETURNS trigger AS $$
DECLARE
    target_tenant VARCHAR(120);
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_tenant := OLD.tenant_id;
    ELSE
        target_tenant := NEW.tenant_id;
    END IF;
    IF target_tenant IS NOT NULL THEN
        UPDATE organization.profile
            SET authz_version = authz_version + 1
            WHERE id = target_tenant;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personas_bump_version ON personas;
CREATE TRIGGER personas_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON personas
    FOR EACH ROW EXECUTE FUNCTION bump_authz_version();

DROP TRIGGER IF EXISTS user_groups_bump_version ON user_groups;
CREATE TRIGGER user_groups_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON user_groups
    FOR EACH ROW EXECUTE FUNCTION bump_authz_version();

DROP TRIGGER IF EXISTS assignments_bump_version ON assignments;
CREATE TRIGGER assignments_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON assignments
    FOR EACH ROW EXECUTE FUNCTION bump_authz_version();

CREATE OR REPLACE FUNCTION bump_authz_version_via_membership() RETURNS trigger AS $$
DECLARE
    target_tenant VARCHAR(120);
    gid uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        gid := OLD.group_id;
    ELSE
        gid := NEW.group_id;
    END IF;
    SELECT tenant_id INTO target_tenant FROM user_groups WHERE id = gid;
    IF target_tenant IS NOT NULL THEN
        UPDATE organization.profile
            SET authz_version = authz_version + 1
            WHERE id = target_tenant;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_group_memberships_bump_version ON user_group_memberships;
CREATE TRIGGER user_group_memberships_bump_version
    AFTER INSERT OR DELETE ON user_group_memberships
    FOR EACH ROW EXECUTE FUNCTION bump_authz_version_via_membership();

--------------DOWN
SET search_path TO organization;

DROP TRIGGER IF EXISTS user_group_memberships_bump_version ON user_group_memberships;
DROP TRIGGER IF EXISTS assignments_bump_version ON assignments;
DROP TRIGGER IF EXISTS user_groups_bump_version ON user_groups;
DROP TRIGGER IF EXISTS personas_bump_version ON personas;
DROP TRIGGER IF EXISTS personas_updated_at ON personas;

DROP FUNCTION IF EXISTS bump_authz_version_via_membership();
DROP FUNCTION IF EXISTS bump_authz_version();
DROP FUNCTION IF EXISTS personas_set_updated_at();

DROP TABLE IF EXISTS authz_audit;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS user_group_memberships;
DROP TABLE IF EXISTS user_groups;
DROP TABLE IF EXISTS personas;

ALTER TABLE organization.profile DROP COLUMN IF EXISTS authz_version;
