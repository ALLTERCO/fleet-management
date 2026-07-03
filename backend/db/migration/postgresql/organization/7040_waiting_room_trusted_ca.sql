--------------UP
-- Layer 2: a waiting-room entry whose cert chains to the FM CA is flagged
-- trusted_ca so operators get a one-click approve instead of a blind decision.
ALTER TABLE organization.device_ingress_waiting_room
    ADD COLUMN IF NOT EXISTS trusted_ca boolean NOT NULL DEFAULT false;

--------------DOWN
ALTER TABLE organization.device_ingress_waiting_room
    DROP COLUMN IF EXISTS trusted_ca;
