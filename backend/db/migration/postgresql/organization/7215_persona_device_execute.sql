--------------UP
-- Grant device:execute to every persona that has device:write, so control
-- survives the execute/write split. Trigger bumps authz_version.
UPDATE organization.personas p
SET statements = (
    SELECT jsonb_agg(
        CASE
            WHEN (stmt -> 'actions') ? 'device:write'
                 AND NOT (stmt -> 'actions') ? 'device:execute'
            THEN jsonb_set(
                stmt, '{actions}',
                (stmt -> 'actions') || '["device:execute"]'::jsonb)
            ELSE stmt
        END
    )
    FROM jsonb_array_elements(p.statements) AS stmt
)
WHERE p.statements @> '[{"actions":["device:write"]}]'::jsonb;

--------------DOWN
-- Strip device:execute where device:write is also present.
UPDATE organization.personas p
SET statements = (
    SELECT jsonb_agg(
        CASE
            WHEN (stmt -> 'actions') ? 'device:execute'
                 AND (stmt -> 'actions') ? 'device:write'
            THEN jsonb_set(
                stmt, '{actions}',
                (SELECT COALESCE(jsonb_agg(a), '[]'::jsonb)
                 FROM jsonb_array_elements(stmt -> 'actions') AS a
                 WHERE a <> '"device:execute"'::jsonb))
            ELSE stmt
        END
    )
    FROM jsonb_array_elements(p.statements) AS stmt
)
WHERE p.statements @> '[{"actions":["device:execute"]}]'::jsonb;
