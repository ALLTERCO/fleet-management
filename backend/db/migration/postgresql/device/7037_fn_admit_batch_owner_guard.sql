--------------UP
-- Scope fn_admit_batch's writes to own-or-unowned rows, matching
-- fn_admit_batch_by_ids (7030). Before this, the access flip and jdoc write hit
-- every matching external_id, so an org-A admit could flip a row owned by org-B
-- to ALLOWED while leaving its owner. The org CASE already kept the owner, but
-- the flip itself had no guard. p_organization_id NULL (deny/quarantine) carries
-- no org to scope by — it is org-scoped upstream — so it keeps the wide match.
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
    WHERE d.external_id = e.ext_id
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);

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

    -- Flip access AND stamp org in one write, scoped to own-or-unowned rows.
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

--------------DOWN
-- Restore the unguarded fn_admit_batch flip (matches migration 7035).
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
    WHERE d.external_id = e.ext_id;

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
