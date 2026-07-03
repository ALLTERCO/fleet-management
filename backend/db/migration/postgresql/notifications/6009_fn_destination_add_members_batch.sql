--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_add_members_batch(
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
    inserted AS (
        INSERT INTO notifications.destination_group_members (
            destination_group_id, member_type, member_id
        )
        SELECT
            p_id,
            s.member_type,
            s.member_id
        FROM src s
        WHERE EXISTS (
            SELECT 1
            FROM notifications.destination_groups d
            WHERE d.id = p_id
              AND d.organization_id = p_organization_id
        )
        ON CONFLICT DO NOTHING
        RETURNING member_type, member_id
    )
    SELECT i.member_type, i.member_id
    FROM inserted i
    ORDER BY i.member_type ASC, i.member_id ASC;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_add_members_batch;
