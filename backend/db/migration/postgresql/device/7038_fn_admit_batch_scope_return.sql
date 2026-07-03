--------------UP
-- Scope the RETURN QUERY to own-or-unowned rows like the writes, so an admit
-- can't hand back a foreign org's row as a genuine admit. NULL org
-- (deny/quarantine) is org-scoped upstream and keeps the wide match.
CREATE OR REPLACE FUNCTION device.fn_admit_batch(
    p_admissions JSONB,
    p_control_access SMALLINT,
    p_organization_id VARCHAR
)
RETURNS TABLE (
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
    IF p_admissions IS NULL
        OR jsonb_typeof(p_admissions) <> 'array'
        OR jsonb_array_length(p_admissions) = 0
    THEN
        RETURN;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    UPDATE device.list d
    SET
        jdoc = COALESCE(e.jdoc, d.jdoc),
        updated = NOW()::TIMESTAMPTZ
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE d.external_id = e.ext_id
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);

    INSERT INTO device.list (external_id, jdoc, organization_id)
    SELECT e.ext_id, e.jdoc, p_organization_id
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE NOT EXISTS (
        SELECT 1 FROM device.list d2 WHERE d2.external_id = e.ext_id
    );

    UPDATE device.list d
    SET control_access = p_control_access,
        organization_id = CASE
            WHEN p_organization_id IS NULL THEN d.organization_id
            WHEN d.organization_id IS NULL THEN p_organization_id
            ELSE d.organization_id
        END
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);
END;
$$
LANGUAGE plpgsql;

--------------DOWN
-- Restore the unscoped RETURN.
CREATE OR REPLACE FUNCTION device.fn_admit_batch(
    p_admissions JSONB,
    p_control_access SMALLINT,
    p_organization_id VARCHAR
)
RETURNS TABLE (
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
    IF p_admissions IS NULL
        OR jsonb_typeof(p_admissions) <> 'array'
        OR jsonb_array_length(p_admissions) = 0
    THEN
        RETURN;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    UPDATE device.list d
    SET
        jdoc = COALESCE(e.jdoc, d.jdoc),
        updated = NOW()::TIMESTAMPTZ
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE d.external_id = e.ext_id
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);

    INSERT INTO device.list (external_id, jdoc, organization_id)
    SELECT e.ext_id, e.jdoc, p_organization_id
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE NOT EXISTS (
        SELECT 1 FROM device.list d2 WHERE d2.external_id = e.ext_id
    );

    UPDATE device.list d
    SET control_access = p_control_access,
        organization_id = CASE
            WHEN p_organization_id IS NULL THEN d.organization_id
            WHEN d.organization_id IS NULL THEN p_organization_id
            ELSE d.organization_id
        END
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );
END;
$$
LANGUAGE plpgsql;
