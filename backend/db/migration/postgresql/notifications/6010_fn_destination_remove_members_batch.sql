--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_remove_members_batch(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_members         JSONB
)
RETURNS TABLE (
    member_type VARCHAR,
    member_id   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH src AS (
        SELECT DISTINCT
            x.member_type::VARCHAR AS member_type,
            x.member_id::VARCHAR AS member_id
        FROM jsonb_to_recordset(COALESCE(p_members, '[]'::jsonb))
            AS x(member_type TEXT, member_id TEXT)
    ),
    deleted AS (
        DELETE FROM notifications.destination_group_members m
        USING notifications.destination_groups d, src s
        WHERE d.id = p_id
          AND d.organization_id = p_organization_id
          AND m.destination_group_id = d.id
          AND m.member_type = s.member_type
          AND m.member_id = s.member_id
        RETURNING m.member_type, m.member_id
    )
    SELECT d.member_type, d.member_id
    FROM deleted d
    ORDER BY d.member_type ASC, d.member_id ASC;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_remove_members_batch;
