--------------UP
-- Delete one topology edge within the caller's org. Returns true if a row
-- existed in this org, false for a no-op — same contract as the logical
-- meter delete.

CREATE OR REPLACE FUNCTION fm.fn_delete_meter_connection(
    p_id BIGINT,
    p_org VARCHAR(120)
)
RETURNS BOOLEAN
AS $$
DECLARE
    v_deleted INT;
BEGIN
    DELETE FROM fm.meter_connection
        WHERE id = p_id AND organization_id = p_org;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_delete_meter_connection(BIGINT, VARCHAR(120));
