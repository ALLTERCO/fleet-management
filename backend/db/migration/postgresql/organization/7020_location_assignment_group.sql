--------------UP
-- Allow a device-group to be assigned to a location; it rolls up to its member
-- devices for "devices in this location" (see device.fn_resolve_scope).
ALTER TABLE organization.location_assignments
    DROP CONSTRAINT IF EXISTS location_assignment_subject_valid;
ALTER TABLE organization.location_assignments
    ADD CONSTRAINT location_assignment_subject_valid
    CHECK (subject_type IN ('device', 'entity', 'group'));

--------------DOWN
ALTER TABLE organization.location_assignments
    DROP CONSTRAINT IF EXISTS location_assignment_subject_valid;
ALTER TABLE organization.location_assignments
    ADD CONSTRAINT location_assignment_subject_valid
    CHECK (subject_type IN ('device', 'entity'));
