--------------UP
-- Promotion creates a first-class BLU identity, so key lifecycle audit now
-- records that creation boundary before later set/clear key events.

ALTER TABLE device.blu_key_event
    DROP CONSTRAINT IF EXISTS blu_key_event_type_valid;

ALTER TABLE device.blu_key_event
    ADD CONSTRAINT blu_key_event_type_valid CHECK (
        event_type IN (
            'promote',
            'set_ref',
            'clear_ref',
            'distribute',
            'rotate_requested',
            'revoke'
        )
    );

--------------DOWN
ALTER TABLE device.blu_key_event
    DROP CONSTRAINT IF EXISTS blu_key_event_type_valid;

ALTER TABLE device.blu_key_event
    ADD CONSTRAINT blu_key_event_type_valid CHECK (
        event_type IN (
            'set_ref',
            'clear_ref',
            'distribute',
            'rotate_requested',
            'revoke'
        )
    );
