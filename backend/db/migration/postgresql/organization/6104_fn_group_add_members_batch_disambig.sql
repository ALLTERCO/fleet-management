--------------UP
-- Disambiguate ON CONFLICT (group_id, ...) which collides with the
-- RETURNS TABLE OUT param of the same name. #variable_conflict use_column
-- tells plpgsql to prefer column refs in mixed-scope SQL.
CREATE OR REPLACE FUNCTION organization.fn_group_add_members_batch(
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
#variable_conflict use_column
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
    INSERT INTO organization.group_members AS gm (
        organization_id, group_id, subject_type, subject_id
    )
    SELECT p_organization_id, p_group_id, s.subject_type, s.subject_id
    FROM unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    ON CONFLICT (group_id, subject_type, subject_id) DO NOTHING
    RETURNING gm.group_id, gm.subject_type, gm.subject_id;
END;
$$;
--------------DOWN
-- No-op: cannot revert to ambiguous form without re-introducing the bug.
