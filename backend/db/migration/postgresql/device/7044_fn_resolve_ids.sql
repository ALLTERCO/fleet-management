--------------UP
-- Resolve product-wide device identities without hydrating device objects.
CREATE OR REPLACE FUNCTION device.fn_resolve_ids(
    p_external_ids VARCHAR(50)[]
) RETURNS TABLE (
    external_id VARCHAR(50),
    id INT
)
AS
$$
BEGIN
    RETURN QUERY (
        SELECT d.external_id, d.id
        FROM device.list d
        WHERE d.external_id = ANY(p_external_ids)
    );
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_resolve_ids(VARCHAR(50)[]);
