--------------UP
-- When each device joined the fleet. A device cannot have reported energy
-- before it existed, so callers read this to tell a brand-new device apart
-- from one that stopped reporting.
CREATE OR REPLACE FUNCTION device.fn_device_join_dates(
    p_ids INT[]
) RETURNS TABLE (
    id INT,
    created TIMESTAMPTZ
)
AS
$$
BEGIN
    RETURN QUERY (
        SELECT d.id, d.created
        FROM device.list d
        WHERE d.id = ANY(p_ids)
    );
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_device_join_dates(INT[]);
