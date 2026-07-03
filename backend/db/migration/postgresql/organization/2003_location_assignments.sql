--------------UP
-- Primary location per device. Entities inherit device location (phase 1).
CREATE TABLE organization.location_assignments (
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    subject_type    VARCHAR(16)  NOT NULL,
    subject_id      VARCHAR(255) NOT NULL,
    location_id     INTEGER      NOT NULL REFERENCES organization.locations(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    CONSTRAINT location_assignment_pk PRIMARY KEY (organization_id, subject_type, subject_id),
    CONSTRAINT location_assignment_subject_valid CHECK (subject_type IN ('device','entity'))
);

CREATE INDEX location_assignments_by_location
    ON organization.location_assignments (organization_id, location_id);

--------------DOWN
DROP TABLE organization.location_assignments;
