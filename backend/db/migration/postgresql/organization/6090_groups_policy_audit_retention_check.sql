--------------UP
-- Extend per-group policy CHECK to accept `auditRetentionDays` override.
ALTER TABLE organization.groups
    DROP CONSTRAINT IF EXISTS groups_metadata_policy_valid;

ALTER TABLE organization.groups
    ADD CONSTRAINT groups_metadata_policy_valid CHECK (
        (metadata->'policy'->>'severityFloor' IS NULL
            OR metadata->'policy'->>'severityFloor' IN ('info','warning','critical'))
        AND
        (metadata->'policy'->>'retentionDays' IS NULL
            OR (metadata->'policy'->>'retentionDays') ~ '^[1-9][0-9]*$')
        AND
        (metadata->'policy'->>'auditRetentionDays' IS NULL
            OR (metadata->'policy'->>'auditRetentionDays') ~ '^[1-9][0-9]*$')
    );
--------------DOWN
ALTER TABLE organization.groups DROP CONSTRAINT IF EXISTS groups_metadata_policy_valid;
ALTER TABLE organization.groups
    ADD CONSTRAINT groups_metadata_policy_valid CHECK (
        (metadata->'policy'->>'severityFloor' IS NULL
            OR metadata->'policy'->>'severityFloor' IN ('info','warning','critical'))
        AND
        (metadata->'policy'->>'retentionDays' IS NULL
            OR (metadata->'policy'->>'retentionDays') ~ '^[1-9][0-9]*$')
    );
