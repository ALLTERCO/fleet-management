--------------UP
-- A credential's identity can be scoped to a single device (expected_external_id),
-- a group (flat membership), or a location (the node + its descendants). The
-- handshake enforces the connecting device falls inside this scope.
ALTER TABLE organization.device_ingress_identity
    ADD COLUMN IF NOT EXISTS scope_kind text;
ALTER TABLE organization.device_ingress_identity
    ADD COLUMN IF NOT EXISTS scope_ref text;

ALTER TABLE organization.device_ingress_identity
    DROP CONSTRAINT IF EXISTS device_ingress_identity_scope_kind_valid;
ALTER TABLE organization.device_ingress_identity
    ADD CONSTRAINT device_ingress_identity_scope_kind_valid
    CHECK (scope_kind IS NULL OR scope_kind IN ('device', 'group', 'location'));

--------------DOWN
ALTER TABLE organization.device_ingress_identity
    DROP CONSTRAINT IF EXISTS device_ingress_identity_scope_kind_valid;
ALTER TABLE organization.device_ingress_identity
    DROP COLUMN IF EXISTS scope_kind;
ALTER TABLE organization.device_ingress_identity
    DROP COLUMN IF EXISTS scope_ref;
