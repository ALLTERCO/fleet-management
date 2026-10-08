--------------UP
-- An installer files a device into its group and location as part of
-- onboarding, not just reads them. Grant group:update + location:update
-- (read-only before). The persona already lists group/location in
-- resource_types, so only the actions change. The personas trigger bumps
-- authz_version. Idempotent + re-runnable.
UPDATE organization.personas p
SET statements = (
    SELECT jsonb_agg(
        CASE
            WHEN (stmt -> 'actions') ? 'group:read'
            THEN jsonb_set(
                stmt, '{actions}',
                ((stmt -> 'actions') - 'group:update' - 'location:update')
                || '["group:update","location:update"]'::jsonb)
            ELSE stmt
        END
    )
    FROM jsonb_array_elements(p.statements) AS stmt
)
WHERE p.is_system_managed = true
  AND p.key = 'installer'
  AND p.statements @> '[{"actions":["group:read"]}]'::jsonb;

--------------DOWN
-- Return group and location to read-only for installer.
UPDATE organization.personas p
SET statements = (
    SELECT jsonb_agg(
        jsonb_set(
            stmt, '{actions}',
            (stmt -> 'actions') - 'group:update' - 'location:update')
    )
    FROM jsonb_array_elements(p.statements) AS stmt
)
WHERE p.is_system_managed = true
  AND p.key = 'installer'
  AND p.statements @> '[{"actions":["group:update"]}]'::jsonb;
