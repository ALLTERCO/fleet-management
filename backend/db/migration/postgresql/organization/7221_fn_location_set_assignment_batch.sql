--------------UP
-- Batch upsert of subject->location assignments in one atomic statement, so a
-- bulk assign is one round-trip instead of one fn_location_set_assignment per
-- subject. Same per-subject upsert semantics as the singular fn (6107); callers
-- must dedup subjects (the PK-conflict DO UPDATE cannot touch a row twice in one
-- statement).
CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment_batch(
    p_organization_id VARCHAR,
    p_location_id     INTEGER,
    p_subject_types   VARCHAR[],
    p_subject_ids     VARCHAR[]
)
RETURNS TABLE (
    organization_id VARCHAR,
    subject_type    VARCHAR,
    subject_id      VARCHAR,
    location_id     INTEGER,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF array_length(p_subject_types, 1) IS DISTINCT FROM array_length(p_subject_ids, 1) THEN
        RAISE EXCEPTION 'subject_types/subject_ids length mismatch'
            USING ERRCODE = '22023';
    END IF;

    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF NOT EXISTS (
        SELECT 1 FROM organization.locations l
        WHERE l.id = p_location_id
          AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    INSERT INTO organization.location_assignments AS la (
        organization_id, subject_type, subject_id, location_id
    )
    SELECT p_organization_id, s.subject_type, s.subject_id, p_location_id
    FROM unnest(p_subject_types, p_subject_ids) AS s(subject_type, subject_id)
    ON CONFLICT ON CONSTRAINT location_assignment_pk
    DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = NOW()
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_location_set_assignment_batch;
