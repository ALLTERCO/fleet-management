--------------UP
-- Mirror cert side: split picked_up_at vs applied_at on credential_pushes,
-- carry the new password through the queue so device_credentials only
-- gets written when the worker confirms.

SET search_path TO organization;

ALTER TABLE credential_pushes
    ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;
COMMENT ON COLUMN credential_pushes.picked_up_at
    IS 'Set when worker transitions row to in_progress.';
COMMENT ON COLUMN credential_pushes.applied_at
    IS 'Set only when status becomes ok (device confirms the new ha1).';

-- New password rides through the queue so the worker, not the request
-- thread, is what eventually publishes to device_credentials.
ALTER TABLE credential_pushes
    ADD COLUMN IF NOT EXISTS password_encrypted text;

--------------DOWN
SET search_path TO organization;

ALTER TABLE credential_pushes DROP COLUMN IF EXISTS password_encrypted;
ALTER TABLE credential_pushes DROP COLUMN IF EXISTS picked_up_at;
