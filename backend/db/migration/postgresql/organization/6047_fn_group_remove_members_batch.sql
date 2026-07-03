--------------UP
CREATE OR REPLACE FUNCTION organization.fn_group_remove_members_batch(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    group_id     INTEGER,
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
        SELECT 1 FROM organization.groups
        WHERE id = p_group_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    DELETE FROM organization.group_members gm
    USING unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    WHERE gm.group_id = p_group_id
      AND gm.organization_id = p_organization_id
      AND gm.subject_type = s.subject_type
      AND gm.subject_id = s.subject_id
    RETURNING gm.group_id, gm.subject_type, gm.subject_id;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_remove_members_batch;
