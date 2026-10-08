--------------UP
-- A deny or quarantine must not bring a device into existence. The old INSERT
-- step ran for every path, so rejecting an id that had no row created a
-- jdoc-less row that can never load. Whether a missing id may be created is a
-- property of the call, not of the control_access, so it becomes a parameter
-- of the write the same way p_override_denied did. Accept passes TRUE because
-- auto-admit depends on the insert. Deny and quarantine pass FALSE: an id with
-- no row is simply not returned, and the caller reports it as an error.
DROP FUNCTION IF EXISTS device.fn_admit_batch(JSONB, SMALLINT, VARCHAR, BOOLEAN);

CREATE FUNCTION device.fn_admit_batch(
    p_admissions JSONB,
    p_control_access SMALLINT,
    p_organization_id VARCHAR,
    p_override_denied BOOLEAN DEFAULT FALSE,
    p_create_missing BOOLEAN DEFAULT TRUE
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
    SET jdoc = COALESCE(e.jdoc, d.jdoc),
        updated = now()::TIMESTAMPTZ
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE d.external_id = e.ext_id
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = e.ext_id
      )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id)
      AND (p_override_denied OR d.control_access <> 2);

    INSERT INTO device.list (external_id, jdoc, organization_id)
    SELECT e.ext_id, e.jdoc, p_organization_id
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE NOT EXISTS (
        SELECT 1 FROM device.list d WHERE d.external_id = e.ext_id
    )
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = e.ext_id
      )
      AND p_create_missing;

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
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = d.external_id
      )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id)
      AND (p_override_denied OR d.control_access <> 2);

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    )
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = d.external_id
      )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);
END;
$$
LANGUAGE plpgsql;
--------------DOWN
-- Restore the four-argument version from 20081, which always inserted.
DROP FUNCTION IF EXISTS device.fn_admit_batch(JSONB, SMALLINT, VARCHAR, BOOLEAN, BOOLEAN);

CREATE FUNCTION device.fn_admit_batch(
    p_admissions JSONB,
    p_control_access SMALLINT,
    p_organization_id VARCHAR,
    p_override_denied BOOLEAN DEFAULT FALSE
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
    SET jdoc = COALESCE(e.jdoc, d.jdoc),
        updated = now()::TIMESTAMPTZ
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE d.external_id = e.ext_id
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = e.ext_id
      )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id)
      AND (p_override_denied OR d.control_access <> 2);

    INSERT INTO device.list (external_id, jdoc, organization_id)
    SELECT e.ext_id, e.jdoc, p_organization_id
    FROM (
        SELECT a->>'external_id' AS ext_id,
               NULLIF(a->'jdoc', 'null'::jsonb) AS jdoc
        FROM jsonb_array_elements(p_admissions) a
    ) e
    WHERE NOT EXISTS (
        SELECT 1 FROM device.list d WHERE d.external_id = e.ext_id
    )
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = e.ext_id
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
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = d.external_id
      )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id)
      AND (p_override_denied OR d.control_access <> 2);

    RETURN QUERY
    SELECT d.external_id, d.id, d.control_access, d.created, d.updated, d.jdoc
    FROM device.list d
    WHERE d.external_id IN (
        SELECT a->>'external_id' FROM jsonb_array_elements(p_admissions) a
    )
      AND NOT EXISTS (
          SELECT 1 FROM device.retired_external_identity r
          WHERE r.external_id = d.external_id
      )
      AND (p_organization_id IS NULL
           OR d.organization_id IS NULL
           OR d.organization_id = p_organization_id);
END;
$$
LANGUAGE plpgsql;
