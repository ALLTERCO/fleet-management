--------------UP
CREATE FUNCTION device.fn_control_access_allow_batch(
    p_ids INT[]
)
RETURNS void
AS
$$
BEGIN
    UPDATE device.list SET control_access = 3 WHERE id = ANY(p_ids);
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION device.fn_control_access_allow_batch;
