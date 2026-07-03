--------------UP
-- Fold organization_id into both admit writes. Accept previously flipped
-- control_access=3 and stamped the owning org in a separate later step; an
-- interrupted or skipped stamp left devices trusted-but-org-less, and an
-- org-less device is invisible to its tenant. Setting org in the same write as
-- control_access removes the window: a row can never be ALLOWED without its
-- org. Tenancy-guarded — only unowned rows take p_organization_id; a row owned
-- by another org keeps its owner. p_organization_id NULL (deny / quarantine)
-- leaves org untouched.
DROP FUNCTION IF EXISTS device.fn_admit_batch(JSONB, SMALLINT);

CREATE FUNCTION device.fn_admit_batch(
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

    -- NULLIF folds JSON null into SQL NULL — `{"jdoc":null}` and a
    -- missing key both mean "don't touch"; COALESCE then keeps d.jdoc.
    UPDATE device.list d
    SET
        jdoc = COALESCE(e.jdoc, d.jdoc),
        updated = NOW()::TIMESTAMPTZ
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE d.external_id = e.ext_id;

    -- New rows carry their org from the first write — never a null-org window.
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

    -- Flip access AND stamp org in one write. Aliases disambiguate the
    -- RETURNS TABLE output column from device.list.external_id.
    UPDATE device.list d
    SET control_access = p_control_access,
        organization_id = CASE
            WHEN p_organization_id IS NULL THEN d.organization_id
            WHEN d.organization_id IS NULL THEN p_organization_id
            ELSE d.organization_id
        END
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );
END;
$$
LANGUAGE plpgsql;

-- Same gate for the admit-by-id path. The WHERE already scopes to unowned or
-- own rows (7030); stamp the org in that same UPDATE.
CREATE OR REPLACE FUNCTION device.fn_admit_batch_by_ids(
    p_ids             INT[],
    p_control_access  SMALLINT,
    p_organization_id VARCHAR
)
RETURNS TABLE (
    external_id    VARCHAR(50),
    id             INT,
    control_access SMALLINT,
    created        TIMESTAMPTZ,
    updated        TIMESTAMPTZ,
    jdoc           JSONB
)
AS
$$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE device.list d
       SET control_access  = p_control_access,
           organization_id = p_organization_id,
           updated         = NOW()::TIMESTAMPTZ
     WHERE d.id = ANY(p_ids)
       AND (d.organization_id = p_organization_id
            OR d.organization_id IS NULL)
    RETURNING d.external_id, d.id, d.control_access,
              d.created, d.updated, d.jdoc;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
-- Restore the pre-org two-arg fn_admit_batch (matches migration 6306).
DROP FUNCTION IF EXISTS device.fn_admit_batch(JSONB, SMALLINT, VARCHAR);

CREATE FUNCTION device.fn_admit_batch(
    p_admissions JSONB,
    p_control_access SMALLINT
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
    WHERE d.external_id = e.ext_id;

    INSERT INTO device.list (external_id, jdoc)
    SELECT e.ext_id, e.jdoc
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE NOT EXISTS (
        SELECT 1 FROM device.list d2 WHERE d2.external_id = e.ext_id
    );

    UPDATE device.list d
    SET control_access = p_control_access
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    );
END;
$$
LANGUAGE plpgsql;

-- Restore the org-scoped-but-not-org-setting fn_admit_batch_by_ids (7030).
CREATE OR REPLACE FUNCTION device.fn_admit_batch_by_ids(
    p_ids             INT[],
    p_control_access  SMALLINT,
    p_organization_id VARCHAR
)
RETURNS TABLE (
    external_id    VARCHAR(50),
    id             INT,
    control_access SMALLINT,
    created        TIMESTAMPTZ,
    updated        TIMESTAMPTZ,
    jdoc           JSONB
)
AS
$$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE device.list d
       SET control_access = p_control_access,
           updated        = NOW()::TIMESTAMPTZ
     WHERE d.id = ANY(p_ids)
       AND (d.organization_id = p_organization_id
            OR d.organization_id IS NULL)
    RETURNING d.external_id, d.id, d.control_access,
              d.created, d.updated, d.jdoc;
END;
$$
LANGUAGE plpgsql;
