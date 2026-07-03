--------------UP
-- Rename profile.metadata.category -> categoryKey so existing rows pass the
-- tightened PROFILE_METADATA_SCHEMA (additionalProperties: false).
-- The draft store reads `metadata.categoryKey`; the seeder used to write
-- `category` — drift made the wizard auto-fill dead. Standardize on
-- categoryKey everywhere.

SET search_path TO device;

UPDATE device.virtual_device_profile
SET metadata = (metadata - 'category')
               || jsonb_build_object('categoryKey', metadata->'category')
WHERE metadata ? 'category'
  AND NOT (metadata ? 'categoryKey');

--------------DOWN
SET search_path TO device;

UPDATE device.virtual_device_profile
SET metadata = (metadata - 'categoryKey')
               || jsonb_build_object('category', metadata->'categoryKey')
WHERE metadata ? 'categoryKey'
  AND NOT (metadata ? 'category');
