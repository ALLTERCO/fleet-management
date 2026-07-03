--------------UP
-- Repair databases where path-drift re-ran legacy 6000 user functions
-- after the password_hash migration.

CREATE OR REPLACE FUNCTION "user".fn_get(
    p_id INT DEFAULT NULL,
    p_name VARCHAR(250) DEFAULT NULL,
    p_password VARCHAR(250) DEFAULT NULL
)
RETURNS table (
        id INT,
        enabled BOOLEAN,
        deleted BOOLEAN,
        name VARCHAR(250),
        full_name VARCHAR(250),
        email VARCHAR(250),
        "group" VARCHAR(255),
        permissions VARCHAR(255)[],
        created TIMESTAMP WITH TIME ZONE,
        updated TIMESTAMP WITH TIME ZONE,
        udf JSONB
    )
AS
$$
BEGIN
    RETURN QUERY (
        SELECT
            d.id, d.enabled, d.deleted, d.name, d.full_name, d.email,
            d.group, d.permissions, d.created, d.updated, d.udf
        FROM "user".list d
        WHERE
            1 = 1
            AND (p_id IS NULL OR d.id = p_id)
            AND (p_name IS NULL OR (d.name = p_name
                AND (p_password IS NULL
                     OR d.password_hash = organization.crypt(p_password, d.password_hash))))
    );
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "user".fn_add(
    p_name VARCHAR(250),
    p_enabled BOOLEAN,
    p_password VARCHAR(250),
    p_full_name VARCHAR(250),
    p_group VARCHAR(255),
    p_email VARCHAR(255),
    p_permissions VARCHAR(255)[]
)
RETURNS table (
    id INT
)
AS
$$
BEGIN
    RETURN QUERY
    INSERT INTO "user".list
        (name, password_hash, full_name, "group", permissions, enabled, email)
    VALUES(
        p_name,
        CASE WHEN p_password IS NULL OR p_password = ''
             THEN NULL
             ELSE organization.crypt(p_password, organization.gen_salt('bf', 12))
        END,
        p_full_name, p_group, p_permissions, p_enabled, p_email
    )
    RETURNING list.id;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "user".fn_update(
    p_id INT,
    p_enabled BOOLEAN DEFAULT NULL,
    p_password VARCHAR(250) DEFAULT NULL,
    p_full_name VARCHAR(250) DEFAULT NULL,
    p_group VARCHAR(255) DEFAULT NULL,
    p_email VARCHAR(255) DEFAULT NULL,
    p_permissions VARCHAR(255)[]  DEFAULT NULL
)
RETURNS BIGINT
AS
$$
BEGIN
    UPDATE "user".list SET
        email = COALESCE(p_email, email),
        password_hash = CASE
            WHEN p_password IS NULL THEN password_hash
            WHEN p_password = '' THEN NULL
            ELSE organization.crypt(p_password, organization.gen_salt('bf', 12))
        END,
        enabled = COALESCE(p_enabled, enabled),
        full_name = COALESCE(p_full_name, full_name),
        "group" = COALESCE(p_group, "group"),
        permissions = COALESCE(p_permissions, permissions)
    WHERE
        id = p_id;
    RETURN p_id;
END;
$$
LANGUAGE plpgsql;

--------------DOWN
SELECT 1;
