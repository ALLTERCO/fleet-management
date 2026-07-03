--------------UP
-- Boot-time seed helper. Accepts JSON array of {group_type, field_key,
-- value} and upserts with ON CONFLICT DO NOTHING — admin edits survive.
CREATE OR REPLACE FUNCTION organization.fn_policy_seed_upsert(
    p_rows JSONB
)
RETURNS TABLE (
    group_type VARCHAR,
    field_key  VARCHAR
)
LANGUAGE sql
AS $$
    INSERT INTO organization.group_type_policy
        (group_type, field_key, value, source, updated_at, updated_by)
    SELECT
        r->>'group_type',
        r->>'field_key',
        r->>'value',
        'env-seed',
        NOW(),
        NULL
    FROM jsonb_array_elements(p_rows) r
    ON CONFLICT (group_type, field_key) DO NOTHING
    RETURNING
        organization.group_type_policy.group_type,
        organization.group_type_policy.field_key;
$$;
--------------DOWN
DROP FUNCTION organization.fn_policy_seed_upsert;
