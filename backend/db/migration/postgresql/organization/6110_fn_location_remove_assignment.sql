--------------UP
-- Remove a subject's primary location assignment. Returns the deleted row.
CREATE OR REPLACE FUNCTION organization.fn_location_remove_assignment(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
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
    RETURN QUERY
    DELETE FROM organization.location_assignments la
    WHERE la.organization_id = p_organization_id
      AND la.subject_type    = p_subject_type
      AND la.subject_id      = p_subject_id
    RETURNING la.organization_id, la.subject_type, la.subject_id,
              la.location_id, la.created_at, la.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_remove_assignment(
    VARCHAR, VARCHAR, VARCHAR
);
