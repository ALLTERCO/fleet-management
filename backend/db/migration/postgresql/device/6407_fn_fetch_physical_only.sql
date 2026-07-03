--------------UP
-- Legacy device fetches hydrate physical Shelly objects only. Virtual,
-- composed, connector, and Bluetooth child identities use their own read paths.
CREATE OR REPLACE FUNCTION device.fn_fetch(
    p_external_id VARCHAR(50) DEFAULT NULL,
    p_id INT DEFAULT NULL,
    p_control_access SMALLINT DEFAULT NULL
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
            d.kind = 'physical'
            AND (p_control_access IS NULL OR d.control_access = p_control_access)
            AND (p_external_id IS NULL OR d.external_id = p_external_id)
            AND (p_id IS NULL OR d.id = p_id)
    );
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_fetch_batch(
    p_external_ids VARCHAR(50)[]
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
            d.kind = 'physical'
            AND d.external_id = ANY(p_external_ids)
    );
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_fetch_batch_by_ids(
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
            d.kind = 'physical'
            AND d.id = ANY(p_ids)
    );
END;
$$
LANGUAGE plpgsql;
--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_fetch(
    p_external_id VARCHAR(50) DEFAULT NULL,
    p_id INT DEFAULT NULL,
    p_control_access SMALLINT DEFAULT NULL
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
            1 = 1
            AND (p_control_access IS NULL OR d.control_access = p_control_access)
            AND (p_external_id IS NULL OR d.external_id = p_external_id)
            AND (p_id IS NULL OR d.id = p_id)
    );
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_fetch_batch(
    p_external_ids VARCHAR(50)[]
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
            d.external_id = ANY(p_external_ids)
    );
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_fetch_batch_by_ids(
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
