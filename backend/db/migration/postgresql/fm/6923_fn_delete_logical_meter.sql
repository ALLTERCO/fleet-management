--------------UP
-- Delete one logical meter within the caller's org. Points cascade via
-- the FK; any child meter's parent_meter_id is set NULL by its own FK.
-- Returns true if a row existed in this org, false for a no-op.

CREATE OR REPLACE FUNCTION fm.fn_delete_logical_meter(
    p_id BIGINT,
    p_org VARCHAR(120)
)
RETURNS BOOLEAN
AS $$
DECLARE
    v_deleted INT;
BEGIN
    DELETE FROM fm.logical_meter
        WHERE id = p_id AND organization_id = p_org;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_delete_logical_meter(BIGINT, VARCHAR(120));
