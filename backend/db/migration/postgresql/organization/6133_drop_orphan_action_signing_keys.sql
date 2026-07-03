--------------UP
-- Strip legacy actionSigningKey* JSONB fields from the zitadel-runtime row.
-- The PreUserinfo Action V2 target is gone (replaced by grant-removed); the
-- runtime keystore was renamed actionSigningKey -> grantSigningKey at the
-- TS layer. Existing deploys still carry the old keys in the JSONB blob;
-- this migration removes them once.

SET search_path TO organization;

UPDATE system_runtime_config
SET value = value
    - 'actionSigningKey'
    - 'actionSigningKeyPrevious',
    updated_at = NOW()
WHERE key = 'zitadel-runtime'
  AND (
      value ? 'actionSigningKey'
      OR value ? 'actionSigningKeyPrevious'
  );

--------------DOWN
-- No down migration: we cannot reconstruct the old signing keys, and they
-- were dead anyway (PreUserinfo target is removed). Re-running rotate
-- regenerates the active keys if needed.
SELECT 1;
