--------------UP
-- Runtime-editable per-type policy overlay. Seed happens at app boot
-- (modules/groupPolicySeed.ts) — migrations can't read process.env.
-- Enum value lists below are coupled with these TS source-of-truth files:
--   group_type  → GROUP_TYPES       (backend/src/types/api/group.ts)
--   field_key   → POLICY_FIELD_KEYS (backend/src/types/api/policy.ts, snake-cased)
--   source      → POLICY_SOURCES    (backend/src/types/api/policy.ts, minus 'unset')
--   severity    → ALERT_SEVERITIES  (backend/src/types/api/alert.ts)
CREATE TABLE IF NOT EXISTS organization.group_type_policy (
    group_type   VARCHAR(32) NOT NULL,
    field_key    VARCHAR(32) NOT NULL,
    value        VARCHAR(32),
    source       VARCHAR(16) NOT NULL DEFAULT 'env-seed',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   VARCHAR(255),
    PRIMARY KEY (group_type, field_key),
    CONSTRAINT group_type_policy_type_valid
        CHECK (group_type IN ('standard','operational','critical','custom')),
    CONSTRAINT group_type_policy_field_valid
        CHECK (field_key IN ('severity_floor','retention_days','audit_retention_days')),
    CONSTRAINT group_type_policy_source_valid
        CHECK (source IN ('env-seed','admin','env-reset')),
    CONSTRAINT group_type_policy_value_shape
        CHECK (
            value IS NULL
            OR (field_key = 'severity_floor'
                AND value IN ('info','warning','critical'))
            OR (field_key IN ('retention_days','audit_retention_days')
                AND value ~ '^[1-9][0-9]*$')
        )
);
--------------DOWN
DROP TABLE IF EXISTS organization.group_type_policy;
