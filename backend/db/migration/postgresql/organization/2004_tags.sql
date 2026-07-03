--------------UP
CREATE TABLE organization.tags (
    id              SERIAL       PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    key             VARCHAR(64)  NOT NULL,
    name            VARCHAR(120) NOT NULL,
    description     VARCHAR(500),
    color           VARCHAR(7),
    icon            VARCHAR(64),
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    CONSTRAINT tags_key_pattern CHECK (key ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
    CONSTRAINT tags_color_pattern CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE UNIQUE INDEX tags_key_unique
    ON organization.tags (organization_id, key);

CREATE TABLE organization.tag_assignments (
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    tag_id          INTEGER      NOT NULL REFERENCES organization.tags(id) ON DELETE CASCADE,
    subject_type    VARCHAR(24)  NOT NULL,
    subject_id      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT tag_assignment_pk PRIMARY KEY (tag_id, subject_type, subject_id),
    CONSTRAINT tag_assignment_subject_valid CHECK (subject_type IN (
        'location','group','device','entity','alert_rule',
        'destination_group','integration_endpoint'
    ))
);

CREATE INDEX tag_assignments_by_subject
    ON organization.tag_assignments (organization_id, subject_type, subject_id);

--------------DOWN
DROP TABLE organization.tag_assignments;
DROP TABLE organization.tags;
