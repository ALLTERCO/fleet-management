--------------UP
-- Reverse lookup: given (subject_type, subject_id) return all tag_ids.
-- Used by group/location/script tag pickers + smart-group resolver.
CREATE OR REPLACE FUNCTION organization.fn_tag_ids_for_subject(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (tag_id INTEGER)
LANGUAGE sql
AS $$
    SELECT ta.tag_id
    FROM organization.tag_assignments ta
    WHERE ta.organization_id = p_organization_id
      AND ta.subject_type    = p_subject_type
      AND ta.subject_id      = p_subject_id
    ORDER BY ta.tag_id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tag_ids_for_subject(
    VARCHAR, VARCHAR, VARCHAR
);
