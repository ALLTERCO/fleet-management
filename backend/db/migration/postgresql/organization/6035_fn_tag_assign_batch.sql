--------------UP
-- Batch assign; idempotent via ON CONFLICT DO NOTHING.
-- Returns only rows actually inserted (skips duplicates).
-- Rejects unknown tag id and cross-org tag via SQLSTATE 22023.
CREATE OR REPLACE FUNCTION organization.fn_tag_assign_batch(
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
    INSERT INTO organization.tag_assignments AS ta (
        organization_id, tag_id, subject_type, subject_id
    )
    SELECT p_organization_id, p_tag_id, s.subject_type, s.subject_id
    FROM unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    ON CONFLICT (tag_id, subject_type, subject_id) DO NOTHING
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_assign_batch;
