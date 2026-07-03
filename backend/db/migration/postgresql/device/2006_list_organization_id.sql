--------------UP
-- Links a device to the organization that owns it. NULL until first approval.
ALTER TABLE device.list ADD COLUMN organization_id VARCHAR(120);
CREATE INDEX idx_device_list_organization ON device.list (organization_id);

-- Preserve pre-org-scope device ownership before the new FK is enforced.
INSERT INTO organization.profile (id, name, display_name, metadata, created_at, updated_at)
SELECT
    ol.id::VARCHAR,
    ol.name,
    ol.name,
    COALESCE(ol.jdoc, '{}'::jsonb)
        || jsonb_build_object(
            'legacySource', 'organization.list',
            'legacyOrganizationId', ol.id
        ),
    COALESCE(ol.created, NOW()),
    ol.updated
FROM organization.list ol
ON CONFLICT (id) DO UPDATE
   SET name = COALESCE(organization.profile.name, EXCLUDED.name),
       display_name = COALESCE(organization.profile.display_name, EXCLUDED.display_name),
       metadata = organization.profile.metadata || EXCLUDED.metadata,
       updated_at = COALESCE(organization.profile.updated_at, EXCLUDED.updated_at);

INSERT INTO organization.profile (id, metadata)
SELECT DISTINCT
    dorg.organization::VARCHAR,
    jsonb_build_object(
        'legacySource', 'device.device_organization',
        'legacyOrganizationId', dorg.organization
    )
FROM device.device_organization dorg
WHERE dorg.organization IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE device.list dl
   SET organization_id = dorg.organization::VARCHAR,
       updated = NOW()
  FROM device.device_organization dorg
 WHERE dorg.device = dl.id
   AND dorg.organization IS NOT NULL
   AND EXISTS (
       SELECT 1
         FROM organization.profile op
        WHERE op.id = dorg.organization::VARCHAR
   );

WITH membership_org AS (
    SELECT
        dl.id,
        MIN(gm.organization_id) AS organization_id
    FROM device.list dl
    JOIN organization.group_members gm
      ON gm.subject_type = 'device'
     AND gm.subject_id = dl.external_id
    WHERE dl.organization_id IS NULL
    GROUP BY dl.id
)
UPDATE device.list dl
   SET organization_id = membership_org.organization_id,
       updated = NOW()
  FROM membership_org
 WHERE membership_org.id = dl.id
   AND EXISTS (
       SELECT 1
         FROM organization.profile op
        WHERE op.id = membership_org.organization_id
   );
--------------DOWN
DROP INDEX IF EXISTS device.idx_device_list_organization;
ALTER TABLE device.list DROP COLUMN organization_id;
