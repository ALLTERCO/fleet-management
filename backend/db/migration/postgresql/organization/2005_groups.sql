--------------UP
-- Per-org logical groups with parent/child hierarchy + multi-subject membership.
CREATE TABLE organization.groups (
    id                SERIAL       PRIMARY KEY,
    organization_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name              VARCHAR(120) NOT NULL,
    description       VARCHAR(500),
    parent_group_id   INTEGER      REFERENCES organization.groups(id) ON DELETE RESTRICT,
    group_type        VARCHAR(24)  NOT NULL DEFAULT 'standard',
    membership_mode   VARCHAR(24)  NOT NULL DEFAULT 'manual',
    metadata          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ,
    CONSTRAINT groups_type_valid CHECK (group_type IN (
        'standard','operational','critical','custom'
    )),
    CONSTRAINT groups_membership_mode_valid CHECK (membership_mode IN ('manual'))
);

CREATE INDEX groups_by_parent ON organization.groups (organization_id, parent_group_id);
-- Case-insensitive unique sibling name per parent (parent may be NULL for roots).
CREATE UNIQUE INDEX groups_name_unique_by_parent
    ON organization.groups (organization_id, parent_group_id, LOWER(name))
    WHERE parent_group_id IS NOT NULL;
CREATE UNIQUE INDEX groups_name_unique_root
    ON organization.groups (organization_id, LOWER(name))
    WHERE parent_group_id IS NULL;

CREATE TABLE organization.group_members (
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    group_id        INTEGER      NOT NULL REFERENCES organization.groups(id) ON DELETE CASCADE,
    subject_type    VARCHAR(24)  NOT NULL,
    subject_id      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT group_member_pk PRIMARY KEY (group_id, subject_type, subject_id),
    CONSTRAINT group_member_subject_valid CHECK (subject_type IN (
        'device','entity','location'
    ))
);

CREATE INDEX group_members_by_subject
    ON organization.group_members (organization_id, subject_type, subject_id);
--------------DOWN
DROP TABLE IF EXISTS organization.group_members;
DROP TABLE IF EXISTS organization.groups;
