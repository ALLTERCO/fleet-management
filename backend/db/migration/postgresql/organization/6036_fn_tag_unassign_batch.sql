--------------UP
-- Batch unassign; returns only rows actually deleted.
-- Rejects unknown tag id and cross-org tag via SQLSTATE 22023.
CREATE OR REPLACE FUNCTION organization.fn_tag_unassign_batch(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    tag_id       INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization.tags
        WHERE id = p_tag_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    DELETE FROM organization.tag_assignments ta
    USING unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    WHERE ta.tag_id = p_tag_id
      AND ta.organization_id = p_organization_id
      AND ta.subject_type = s.subject_type
      AND ta.subject_id = s.subject_id
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_unassign_batch;
