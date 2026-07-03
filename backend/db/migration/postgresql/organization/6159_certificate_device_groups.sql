--------------UP
-- M:N: which device groups this cert serves. Typed FK answers
-- "which certs apply to group X" with referential integrity; tags
-- handle long-tail filters.

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS organization.certificate_device_groups (
    certificate_id  uuid    NOT NULL REFERENCES organization.certificates(id) ON DELETE CASCADE,
    group_id        integer NOT NULL REFERENCES organization.groups(id)       ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    PRIMARY KEY (certificate_id, group_id)
);

CREATE INDEX IF NOT EXISTS certificate_device_groups_cert_idx
    ON organization.certificate_device_groups (certificate_id);
CREATE INDEX IF NOT EXISTS certificate_device_groups_group_idx
    ON organization.certificate_device_groups (group_id);

--------------DOWN
SET search_path TO organization;
DROP TABLE IF EXISTS organization.certificate_device_groups;
