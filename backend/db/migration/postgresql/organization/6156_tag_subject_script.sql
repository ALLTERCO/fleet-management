--------------UP
-- Future-proof: allow tag_assignments to carry 'script' rows BEFORE the
-- scripts module ships. Same shape as existing subject kinds; the API
-- guard rejects 'script' at the boundary until the scripts namespace
-- lands, so the SQL gate is the long-lived backstop.

ALTER TABLE organization.tag_assignments
    DROP CONSTRAINT IF EXISTS tag_assignment_subject_valid;

ALTER TABLE organization.tag_assignments
    ADD CONSTRAINT tag_assignment_subject_valid CHECK (
        subject_type IN (
            'location', 'group', 'device', 'entity',
            'alert_rule', 'destination_group', 'integration_endpoint',
            'script'
        )
    );

--------------DOWN
ALTER TABLE organization.tag_assignments
    DROP CONSTRAINT IF EXISTS tag_assignment_subject_valid;

ALTER TABLE organization.tag_assignments
    ADD CONSTRAINT tag_assignment_subject_valid CHECK (
        subject_type IN (
            'location', 'group', 'device', 'entity',
            'alert_rule', 'destination_group', 'integration_endpoint'
        )
    );
