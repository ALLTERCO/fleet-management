--------------UP
SET search_path TO organization;

ALTER TABLE organization.device_ingress_setup_session
    ADD COLUMN IF NOT EXISTS bundle_fetch_count integer NOT NULL DEFAULT 0;

--------------DOWN
SET search_path TO organization;

ALTER TABLE organization.device_ingress_setup_session
    DROP COLUMN IF EXISTS bundle_fetch_count;
