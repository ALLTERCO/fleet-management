--------------UP
-- Old single-tenant installs can have devices with no legacy org edge.
-- Preserve them by assigning the remaining orphans to the best legacy org.
INSERT INTO organization.profile (id, name, display_name, metadata, created_at, updated_at)
SELECT
    'legacy',
    'Legacy',
    'Legacy',
    jsonb_build_object('legacySource', 'device.list.orphan'),
    NOW(),
    NOW()
WHERE EXISTS (SELECT 1 FROM device.list WHERE organization_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM organization.profile);

WITH fallback_org AS (
    SELECT id AS organization_id
      FROM organization.profile
     ORDER BY
        CASE
            WHEN metadata->>'legacySource' = 'organization.list' THEN 0
            WHEN id = 'legacy' THEN 1
            ELSE 2
        END,
        id
     LIMIT 1
)
UPDATE device.list dl
   SET organization_id = fallback_org.organization_id,
       updated = NOW(),
       jdoc = COALESCE(dl.jdoc, '{}'::jsonb)
            || jsonb_build_object(
                'legacyOrganizationBackfill', TRUE,
                'legacyOrganizationBackfillSource', 'device.list.orphan'
            )
  FROM fallback_org
 WHERE dl.organization_id IS NULL;

--------------DOWN
UPDATE device.list
   SET organization_id = NULL,
       jdoc = COALESCE(jdoc, '{}'::jsonb)
            - 'legacyOrganizationBackfill'
            - 'legacyOrganizationBackfillSource'
 WHERE jdoc->>'legacyOrganizationBackfillSource' = 'device.list.orphan';
