--------------UP
-- Legacy single-tenant installs stored organizations in organization.list
-- before organization.profile existed. Copy that ownership early so later
-- UI/device migrations can attach legacy rows before NOT NULL/FK guards.
DO $$
BEGIN
    IF to_regclass('organization.list') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO organization.profile (
                id,
                name,
                display_name,
                metadata,
                created_at,
                updated_at
            )
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
                   display_name = COALESCE(
                       organization.profile.display_name,
                       EXCLUDED.display_name
                   ),
                   metadata = organization.profile.metadata || EXCLUDED.metadata,
                   updated_at = COALESCE(
                       organization.profile.updated_at,
                       EXCLUDED.updated_at
                   )
        $sql$;
    END IF;

    IF to_regclass('device.device_organization') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO organization.profile (id, metadata)
            SELECT DISTINCT
                dorg.organization::VARCHAR,
                jsonb_build_object(
                    'legacySource', 'device.device_organization',
                    'legacyOrganizationId', dorg.organization
                )
            FROM device.device_organization dorg
            WHERE dorg.organization IS NOT NULL
            ON CONFLICT (id) DO NOTHING
        $sql$;
    END IF;
END
$$;
--------------DOWN
SELECT 1;
