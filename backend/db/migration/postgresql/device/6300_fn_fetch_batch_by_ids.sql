--------------UP
CREATE FUNCTION device.fn_fetch_batch_by_ids(
    p_ids INT[]
) RETURNS table (
        external_id VARCHAR(50),
        id INT,
        control_access SMALLINT,
        created TIMESTAMPTZ,
        updated TIMESTAMPTZ,
        jdoc JSONB
    )
AS
$$
BEGIN
    RETURN QUERY (
        SELECT
            d.external_id,
            d.id,
            d.control_access,
            d.created,
            d.updated,
            d.jdoc
        FROM
            device.list d
        WHERE
            d.id = ANY(p_ids)
    );
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION device.fn_fetch_batch_by_ids;
