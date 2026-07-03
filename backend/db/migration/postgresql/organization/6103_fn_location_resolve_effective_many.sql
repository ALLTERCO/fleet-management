--------------UP
-- Batch variant of fn_location_resolve_effective. One recursive CTE walks
-- every requested id's ancestor chain, letting Location.List / .Children
-- attach inherited fields without an N+1.
CREATE OR REPLACE FUNCTION organization.fn_location_resolve_effective_many(
    p_organization_id VARCHAR,
    p_ids             INTEGER[]
)
RETURNS TABLE (
    id              INTEGER,
    timezone        VARCHAR,
    country_code    VARCHAR,
    currency        VARCHAR,
    regulatory_zone VARCHAR,
    compliance_tags TEXT[]
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE chain AS (
        -- Seeds: one row per requested id.
        SELECT l.id AS root_id,
               l.id, l.parent_location_id, 1 AS depth,
               l.timezone, l.country_code, l.currency,
               l.regulatory_zone, l.compliance_tags
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND l.id = ANY(p_ids)
        UNION ALL
        SELECT c.root_id,
               l.id, l.parent_location_id, c.depth + 1,
               l.timezone, l.country_code, l.currency,
               l.regulatory_zone, l.compliance_tags
        FROM organization.locations l
        JOIN chain c ON l.id = c.parent_location_id
        WHERE l.organization_id = p_organization_id
          AND c.depth < 64
    )
    SELECT
        root_id AS id,
        (SELECT timezone        FROM chain ch WHERE ch.root_id = chain.root_id AND ch.timezone        IS NOT NULL ORDER BY ch.depth LIMIT 1),
        (SELECT country_code    FROM chain ch WHERE ch.root_id = chain.root_id AND ch.country_code    IS NOT NULL ORDER BY ch.depth LIMIT 1),
        (SELECT currency        FROM chain ch WHERE ch.root_id = chain.root_id AND ch.currency        IS NOT NULL ORDER BY ch.depth LIMIT 1),
        (SELECT regulatory_zone FROM chain ch WHERE ch.root_id = chain.root_id AND ch.regulatory_zone IS NOT NULL ORDER BY ch.depth LIMIT 1),
        COALESCE(
            ARRAY(
                SELECT DISTINCT tag
                FROM chain ch, unnest(COALESCE(ch.compliance_tags, ARRAY[]::TEXT[])) AS tag
                WHERE ch.root_id = chain.root_id
                ORDER BY tag
            ),
            ARRAY[]::TEXT[]
        )
    FROM chain
    GROUP BY root_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_resolve_effective_many(VARCHAR, INTEGER[]);
