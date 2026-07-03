--------------UP
-- Legacy `device.groups` replaced by `organization.groups` + `organization.group_members`.
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

INSERT INTO organization.profile (id, name, display_name, metadata)
SELECT
    'legacy',
    'Legacy',
    'Legacy',
    jsonb_build_object('legacySource', 'device.groups')
WHERE EXISTS (SELECT 1 FROM device.groups)
  AND NOT EXISTS (SELECT 1 FROM organization.profile);

WITH fallback_org AS (
    SELECT id AS organization_id
      FROM organization.profile
     ORDER BY CASE WHEN id = 'legacy' THEN 1 ELSE 0 END, id
     LIMIT 1
),
group_org AS (
    SELECT
        g.id,
        COALESCE(
            MIN(dorg.organization::VARCHAR) FILTER (WHERE dorg.organization IS NOT NULL),
            (SELECT organization_id FROM fallback_org)
        ) AS organization_id
    FROM device.groups g
    LEFT JOIN LATERAL unnest(COALESCE(g.devices, '{}'::TEXT[])) AS member(raw_id)
        ON TRUE
    LEFT JOIN device.list dl
        ON dl.external_id = member.raw_id
        OR dl.id::TEXT = member.raw_id
    LEFT JOIN device.device_organization dorg
        ON dorg.device = dl.id
    GROUP BY g.id
),
legacy_groups AS (
    SELECT
        g.*,
        go.organization_id,
        COUNT(*) OVER (
            PARTITION BY go.organization_id, g.parent_id, LOWER(g.name)
        ) AS sibling_name_count
    FROM device.groups g
    JOIN group_org go ON go.id = g.id
),
prepared_groups AS (
    SELECT
        lg.id,
        lg.organization_id,
        CASE
            WHEN lg.sibling_name_count = 1 THEN LEFT(lg.name, 120)
            ELSE LEFT(lg.name, 110) || ' #' || lg.id::TEXT
        END AS name,
        CASE
            WHEN lg.parent_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM legacy_groups parent WHERE parent.id = lg.parent_id)
                THEN lg.parent_id
            ELSE NULL
        END AS parent_group_id,
        COALESCE(lg.metadata, '{}'::jsonb)
            || jsonb_build_object(
                'legacySource', 'device.groups',
                'legacyGroupId', lg.id
            ) AS metadata,
        COALESCE(lg.created, NOW()) AS created_at,
        lg.updated AS updated_at
    FROM legacy_groups lg
)
INSERT INTO organization.groups (
    id,
    organization_id,
    name,
    parent_group_id,
    group_type,
    membership_mode,
    metadata,
    created_at,
    updated_at
)
SELECT
    id,
    organization_id,
    name,
    parent_group_id,
    'standard',
    'manual',
    metadata,
    created_at,
    updated_at
FROM prepared_groups
WHERE organization_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

WITH fallback_org AS (
    SELECT id AS organization_id
      FROM organization.profile
     ORDER BY CASE WHEN id = 'legacy' THEN 1 ELSE 0 END, id
     LIMIT 1
),
group_org AS (
    SELECT
        g.id,
        COALESCE(
            MIN(dorg.organization::VARCHAR) FILTER (WHERE dorg.organization IS NOT NULL),
            (SELECT organization_id FROM fallback_org)
        ) AS organization_id
    FROM device.groups g
    LEFT JOIN LATERAL unnest(COALESCE(g.devices, '{}'::TEXT[])) AS member(raw_id)
        ON TRUE
    LEFT JOIN device.list dl
        ON dl.external_id = member.raw_id
        OR dl.id::TEXT = member.raw_id
    LEFT JOIN device.device_organization dorg
        ON dorg.device = dl.id
    GROUP BY g.id
),
legacy_members AS (
    SELECT
        go.organization_id,
        g.id AS group_id,
        COALESCE(dl.external_id, member.raw_id) AS subject_id
    FROM device.groups g
    JOIN group_org go ON go.id = g.id
    CROSS JOIN LATERAL unnest(COALESCE(g.devices, '{}'::TEXT[])) AS member(raw_id)
    LEFT JOIN device.list dl
        ON dl.external_id = member.raw_id
        OR dl.id::TEXT = member.raw_id
    WHERE NULLIF(TRIM(member.raw_id), '') IS NOT NULL
)
INSERT INTO organization.group_members (
    organization_id,
    group_id,
    subject_type,
    subject_id
)
SELECT
    organization_id,
    group_id,
    'device',
    subject_id
FROM legacy_members
WHERE organization_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM organization.groups g WHERE g.id = legacy_members.group_id)
ON CONFLICT (group_id, subject_type, subject_id) DO NOTHING;

SELECT setval(
    pg_get_serial_sequence('organization.groups', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 1) FROM organization.groups), 1),
    TRUE
);

DROP FUNCTION IF EXISTS device.fn_groups_add_device CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_add_devices_batch CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_create CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_delete CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_find_by_device CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_get CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_list CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_remove_device CASCADE;
DROP FUNCTION IF EXISTS device.fn_groups_update CASCADE;
-- LINT-IGNORE: additive-only — legacy table is copied above before removal.
DROP TABLE IF EXISTS device.groups CASCADE;
--------------DOWN
-- Greenfield rewrite; no restore path for the legacy table.
