--------------UP
-- Upsert primary location assignment for a device/entity. Idempotent.
-- Validates same-org location (SQLSTATE 22023 on mismatch).
CREATE OR REPLACE FUNCTION organization.fn_location_set_assignment(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_location_id     INTEGER
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
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF NOT EXISTS (
        SELECT 1 FROM organization.locations
        WHERE id = p_location_id
          AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    INSERT INTO organization.location_assignments AS la (
        organization_id, subject_type, subject_id, location_id
    )
    VALUES (p_organization_id, p_subject_type, p_subject_id, p_location_id)
    ON CONFLICT (organization_id, subject_type, subject_id)
    DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = NOW()
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_location_set_assignment;
