--------------UP
-- Record the JWT kid each FM scoped PAT was signed under. During a key
-- rotation the operator can query
--
--   SELECT count(*) FROM organization.fm_scoped_pats
--    WHERE revoked_at IS NULL AND expires_at > now() AND kid = '<old>';
--
-- to know when the rotation window can be closed (all PATs minted under
-- the old kid have expired or been re-rotated).
--
-- Existing rows default to 'primary' — that matches the env default
-- (FM_JWT_KID_CURRENT, defaults to 'primary' when unset) so historical
-- tokens that carry kid='primary' in their header still tally correctly.
-- LINT-IGNORE: additive-only
ALTER TABLE organization.fm_scoped_pats
    ADD COLUMN IF NOT EXISTS kid text NOT NULL DEFAULT 'primary';
--------------DOWN
ALTER TABLE organization.fm_scoped_pats DROP COLUMN IF EXISTS kid;
