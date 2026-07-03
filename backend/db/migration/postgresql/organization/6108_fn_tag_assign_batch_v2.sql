--------------UP
-- Disambiguate column references — RETURNS TABLE columns shadow bare
-- column names in the IF EXISTS subquery and ON CONFLICT target. Alias
-- both query sites (t.*, ta.*).
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
        SELECT 1 FROM organization.tags t
        WHERE t.id = p_tag_id AND t.organization_id = p_organization_id
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
    ON CONFLICT ON CONSTRAINT tag_assignment_pk DO NOTHING
    RETURNING ta.tag_id, ta.subject_type, ta.subject_id;
END;
$$;
--------------DOWN
-- Revert handled by re-running 6035 migration.
