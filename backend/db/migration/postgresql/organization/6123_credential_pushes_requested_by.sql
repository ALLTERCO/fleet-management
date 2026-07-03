--------------UP
-- Preserve the operator who initiated a credential push so device_credentials.rotated_by
-- carries the real actor instead of 'system:credential-push-worker'.

SET search_path TO organization;

ALTER TABLE credential_pushes
    ADD COLUMN IF NOT EXISTS requested_by text;
COMMENT ON COLUMN credential_pushes.requested_by
    IS 'Username of the operator who queued the push; null for system-initiated.';

--------------DOWN
SET search_path TO organization;

ALTER TABLE credential_pushes DROP COLUMN IF EXISTS requested_by;
