--------------UP
-- Resolve inherited fields by walking the parent chain. Child values
-- win; fall through to the nearest ancestor that has the field set.
-- Depth-capped at 64 (same pattern as fn_group_descendants_count).
-- compliance_tags inherits as a UNION: ancestors' tags contribute, the
-- child's tags extend rather than replace.
CREATE OR REPLACE FUNCTION organization.fn_location_resolve_effective(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
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
        SELECT id, parent_location_id, 1 AS depth,
               timezone, country_code, currency, regulatory_zone, compliance_tags
        FROM organization.locations
        WHERE id = p_id AND organization_id = p_organization_id
        UNION ALL
        SELECT l.id, l.parent_location_id, c.depth + 1,
               l.timezone, l.country_code, l.currency,
               l.regulatory_zone, l.compliance_tags
        FROM organization.locations l
        JOIN chain c ON l.id = c.parent_location_id
        WHERE l.organization_id = p_organization_id
          AND c.depth < 64
    )
    SELECT
        -- First non-null in chain order (self → ancestors).
        (SELECT timezone        FROM chain WHERE timezone        IS NOT NULL ORDER BY depth LIMIT 1),
        (SELECT country_code    FROM chain WHERE country_code    IS NOT NULL ORDER BY depth LIMIT 1),
        (SELECT currency        FROM chain WHERE currency        IS NOT NULL ORDER BY depth LIMIT 1),
        (SELECT regulatory_zone FROM chain WHERE regulatory_zone IS NOT NULL ORDER BY depth LIMIT 1),
        -- Union of all ancestor tags + self. Order irrelevant; dedup via DISTINCT.
        COALESCE(
            ARRAY(
                SELECT DISTINCT tag
                FROM chain, unnest(COALESCE(compliance_tags, ARRAY[]::TEXT[])) AS tag
                ORDER BY tag
            ),
            ARRAY[]::TEXT[]
        );
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_resolve_effective(VARCHAR, INTEGER);
