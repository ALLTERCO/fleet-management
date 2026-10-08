--------------UP
-- One admission write for every path. Auto-admit (a Discovery intent) must
-- never turn a DENIED row into ALLOWED, and a read-then-write cannot promise
-- that: an operator deny can land between the read and the write. So the
-- guard is a parameter of the write itself. Operators pass TRUE (accepting
-- from the Denied list is a deliberate revive). Auto-admit passes FALSE: a
-- DENIED row is left untouched and still returned, so the caller can tell
-- "refused" from "admitted" by the control_access it gets back.
DROP FUNCTION IF EXISTS device.fn_admit_batch(JSONB, SMALLINT, VARCHAR);

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
--------------DOWN
-- Restore the unguarded three-argument version from 7300.
DROP FUNCTION IF EXISTS device.fn_admit_batch(JSONB, SMALLINT, VARCHAR, BOOLEAN);

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
           OR d.organization_id = p_organization_id);

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
           OR d.organization_id = p_organization_id);

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
