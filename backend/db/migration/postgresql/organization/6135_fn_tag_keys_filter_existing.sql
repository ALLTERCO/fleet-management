--------------UP
-- Returns the subset of candidate keys that already exist for an org.
-- Replaces TagComponent.resolveUniqueKey's up-to-100 sequential
-- fn_tag_list probes with a single round-trip.
CREATE FUNCTION organization.fn_tag_keys_filter_existing(
    p_organization_id VARCHAR,
    p_keys VARCHAR[]
)
RETURNS TABLE (key VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT t.key
    FROM organization.tags t
    WHERE t.organization_id = p_organization_id
      AND t.key = ANY(p_keys);
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_keys_filter_existing;
