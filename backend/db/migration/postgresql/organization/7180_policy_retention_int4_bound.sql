--------------UP
-- Bound retention/audit-retention policy values to 9 digits so they fit INT4.
-- The prior regex `^[1-9][0-9]*$` accepted any length; a 10+ digit value passed
-- the constraint but overflowed the ::INTEGER cast in every policy resolver
-- (fn_group_list/get, fn_device_retention_days, fn_device_audit_retention_days),
-- breaking group listing and the retention sweeps. 9 digits ⇒ ≤ 999999999 < 2^31.
ALTER TABLE organization.groups
    DROP CONSTRAINT IF EXISTS groups_metadata_policy_valid;
ALTER TABLE organization.groups
    ADD CONSTRAINT groups_metadata_policy_valid CHECK (
        (metadata->'policy'->>'severityFloor' IS NULL
            OR metadata->'policy'->>'severityFloor'
                IN ('info', 'warning', 'critical'))
        AND
        (metadata->'policy'->>'retentionDays' IS NULL
            OR (metadata->'policy'->>'retentionDays') ~ '^[1-9][0-9]{0,8}$')
        AND
        (metadata->'policy'->>'auditRetentionDays' IS NULL
            OR (metadata->'policy'->>'auditRetentionDays') ~ '^[1-9][0-9]{0,8}$')
    );

ALTER TABLE organization.group_type_policy
    DROP CONSTRAINT IF EXISTS group_type_policy_value_shape;
ALTER TABLE organization.group_type_policy
    ADD CONSTRAINT group_type_policy_value_shape CHECK (
        value IS NULL
        OR (field_key = 'severity_floor'
            AND value IN ('info', 'warning', 'critical'))
        OR (field_key IN ('retention_days', 'audit_retention_days')
            AND value ~ '^[1-9][0-9]{0,8}$')
    );
--------------DOWN
ALTER TABLE organization.groups
    DROP CONSTRAINT IF EXISTS groups_metadata_policy_valid;
ALTER TABLE organization.groups
    ADD CONSTRAINT groups_metadata_policy_valid CHECK (
        (metadata->'policy'->>'severityFloor' IS NULL
            OR metadata->'policy'->>'severityFloor'
                IN ('info', 'warning', 'critical'))
        AND
        (metadata->'policy'->>'retentionDays' IS NULL
            OR (metadata->'policy'->>'retentionDays') ~ '^[1-9][0-9]*$')
        AND
        (metadata->'policy'->>'auditRetentionDays' IS NULL
            OR (metadata->'policy'->>'auditRetentionDays') ~ '^[1-9][0-9]*$')
    );

ALTER TABLE organization.group_type_policy
    DROP CONSTRAINT IF EXISTS group_type_policy_value_shape;
ALTER TABLE organization.group_type_policy
    ADD CONSTRAINT group_type_policy_value_shape CHECK (
        value IS NULL
        OR (field_key = 'severity_floor'
            AND value IN ('info', 'warning', 'critical'))
        OR (field_key IN ('retention_days', 'audit_retention_days')
            AND value ~ '^[1-9][0-9]*$')
    );
