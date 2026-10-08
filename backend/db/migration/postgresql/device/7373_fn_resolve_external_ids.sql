--------------UP
-- Mirror of fn_resolve_ids for the other direction: internal row ids in,
-- product-wide identities out, without hydrating device objects. A logical
-- meter stores internal ids, while tariff assignment resolution is keyed by
-- external id, so billing a meter needs this translation.
CREATE OR REPLACE FUNCTION device.fn_resolve_external_ids(
    p_ids INT[]
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
        WHERE d.id = ANY(p_ids)
    );
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_resolve_external_ids(INT[]);
