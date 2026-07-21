--------------UP
SET search_path TO device, public;

CREATE TABLE IF NOT EXISTS device.retired_external_identity (
    external_id     VARCHAR(50) PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    device_id       INTEGER NOT NULL REFERENCES device.list(id) ON DELETE CASCADE,
    retired_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason          VARCHAR(32) NOT NULL DEFAULT 'hardware_replacement'
        CHECK (reason IN ('hardware_replacement'))
);

COMMENT ON TABLE device.retired_external_identity IS
    'Hardware identities that must not create a second logical device after replacement.';

CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_entries IS NULL
        OR jsonb_typeof(p_entries) <> 'array'
        OR jsonb_array_length(p_entries) = 0
    THEN
        RETURN 0;
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    WITH input AS (
        SELECT DISTINCT ON (external_id)
            external_id,
            jdoc
        FROM (
            SELECT
                NULLIF(e.entry->>'external_id', '')::VARCHAR(50) AS external_id,
                NULLIF(e.entry->'jdoc', 'null'::jsonb) AS jdoc,
                e.ordinality
            FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS e(entry, ordinality)
        ) raw
        WHERE external_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM device.retired_external_identity r
              WHERE r.external_id = raw.external_id
          )
        ORDER BY external_id, ordinality DESC
    ),
    updated AS (
        UPDATE device.list d
        SET jdoc = COALESCE(i.jdoc, d.jdoc),
            updated = now()::TIMESTAMPTZ
        FROM input i
        WHERE d.external_id = i.external_id
        RETURNING d.external_id
    ),
    inserted AS (
        INSERT INTO device.list (external_id, jdoc)
        SELECT i.external_id, i.jdoc
        FROM input i
        WHERE NOT EXISTS (
            SELECT 1 FROM updated u WHERE u.external_id = i.external_id
        )
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc = COALESCE(EXCLUDED.jdoc, device.list.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING external_id
    )
    SELECT count(*) INTO v_count
    FROM (
        SELECT external_id FROM updated
        UNION ALL
        SELECT external_id FROM inserted
    ) written;

    RETURN v_count;
END;
$$;

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

CREATE OR REPLACE FUNCTION device.fn_hardware_requirements_fingerprint(
    p_device_id INTEGER
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH requirements AS (
        SELECT jsonb_build_object(
                   'channel', p.channel,
                   'phase', p.phase,
                   'tag', p.tag,
                   'electricalDomain', p.electrical_domain,
                   'logicalMeterId', m.id,
                   'logicalMeterName', m.name,
                   'utilityType', m.utility_type,
                   'role', m.role
               ) AS requirement
          FROM fm.logical_meter_point p
          JOIN fm.logical_meter m ON m.id = p.logical_meter_id
         WHERE p.device = p_device_id
         ORDER BY m.id, p.channel, p.phase, p.tag
    )
    SELECT md5(COALESCE(jsonb_agg(requirement), '[]'::jsonb)::TEXT)
      FROM requirements;
$$;

DROP FUNCTION IF EXISTS device.fn_replace_hardware(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB
);

CREATE FUNCTION device.fn_replace_hardware(
    p_organization_id VARCHAR,
    p_old_external_id VARCHAR,
    p_new_external_id VARCHAR,
    p_confirmed_by VARCHAR,
    p_compatibility VARCHAR,
    p_mapping JSONB,
    p_requirements_fingerprint TEXT
)
RETURNS TABLE (
    device_id INT,
    old_external_id VARCHAR,
    new_external_id VARCHAR,
    audit_id BIGINT
)
AS
$$
DECLARE
    v_old device.list%ROWTYPE;
    v_new device.list%ROWTYPE;
    v_audit_id BIGINT;
    v_updated INT;
    v_requirements_fingerprint TEXT;
BEGIN
    IF p_organization_id IS NULL OR p_organization_id = '' THEN
        RAISE EXCEPTION 'organization is required';
    END IF;
    IF p_old_external_id IS NULL OR p_old_external_id = ''
        OR p_new_external_id IS NULL OR p_new_external_id = ''
    THEN
        RAISE EXCEPTION 'old and new external ids are required';
    END IF;
    IF p_old_external_id = p_new_external_id THEN
        RAISE EXCEPTION 'old and new external ids must differ';
    END IF;
    IF p_compatibility NOT IN ('exact_match', 'compatible_mapping') THEN
        RAISE EXCEPTION 'unsupported compatibility %', p_compatibility;
    END IF;
    IF p_requirements_fingerprint IS NULL OR p_requirements_fingerprint = '' THEN
        RAISE EXCEPTION 'requirements fingerprint is required';
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    SELECT * INTO v_old
    FROM device.list
    WHERE external_id = p_old_external_id
      AND organization_id = p_organization_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'old device % not found in organization %',
            p_old_external_id, p_organization_id;
    END IF;

    PERFORM pg_advisory_xact_lock(73002, v_old.id);

    SELECT device.fn_hardware_requirements_fingerprint(v_old.id)
      INTO v_requirements_fingerprint;
    IF v_requirements_fingerprint IS DISTINCT FROM p_requirements_fingerprint THEN
        RAISE EXCEPTION 'hardware replacement requirements changed; check again';
    END IF;

    SELECT * INTO v_new
    FROM device.list
    WHERE external_id = p_new_external_id
      AND organization_id = p_organization_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'new device % not found in organization %',
            p_new_external_id, p_organization_id;
    END IF;

    IF p_compatibility = 'compatible_mapping'
        AND p_mapping IS NOT NULL
        AND jsonb_typeof(p_mapping) = 'array'
    THEN
        UPDATE fm.logical_meter_point AS lmp
        SET channel = (m->>'toChannel')::SMALLINT,
            phase = m->>'toPhase',
            tag = m->>'toTag'
        FROM jsonb_array_elements(p_mapping) AS m
        WHERE lmp.device = v_old.id
          AND lmp.channel = (m->>'fromChannel')::SMALLINT
          AND lmp.tag = m->>'fromTag'
          AND lmp.logical_meter_id IN (
              SELECT id FROM fm.logical_meter
              WHERE organization_id = p_organization_id
          );

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> jsonb_array_length(p_mapping) THEN
            RAISE EXCEPTION 'hardware remap: expected % point updates, applied %',
                jsonb_array_length(p_mapping), v_updated;
        END IF;
    END IF;

    UPDATE device.list
       SET external_id = NULL
     WHERE id = v_new.id;

    UPDATE device.list
       SET external_id = p_new_external_id,
           jdoc = COALESCE(v_new.jdoc, v_old.jdoc),
           control_access = v_new.control_access,
           updated = now()::TIMESTAMPTZ
     WHERE id = v_old.id;

    PERFORM organization.fn_reassign_device_ownership(
        p_organization_id, v_old.id, v_new.id, p_new_external_id
    );
    PERFORM ui.fn_reassign_device_ownership(
        p_organization_id, v_old.id, v_new.id
    );
    PERFORM notifications.fn_reassign_device_ownership(
        p_organization_id, v_old.id, v_new.id
    );
    PERFORM device.fn_reassign_serves_ownership(
        p_organization_id, v_old.id, v_new.id
    );
    PERFORM device.fn_reassign_event_log_ownership(v_old.id, v_new.id);
    PERFORM device.fn_reassign_virtual_metadata_ownership(
        p_organization_id, v_old.id, v_new.id, p_new_external_id
    );
    PERFORM device.fn_reassign_device_source_references(
        p_organization_id, v_old.id, v_new.id
    );
    PERFORM logging.fn_reassign_device_ownership(v_old.id, v_new.id);

    INSERT INTO device.retired_external_identity (
        external_id, organization_id, device_id
    ) VALUES (
        p_old_external_id, p_organization_id, v_old.id
    )
    ON CONFLICT (external_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        device_id = EXCLUDED.device_id,
        retired_at = now();

    -- The new row is staging data. The retained logical device starts using
    -- the new hardware only after this transaction commits.
    DELETE FROM device.status WHERE id = v_new.id;
    DELETE FROM device_em.stats WHERE device = v_new.id;
    DELETE FROM device_em.energy_15min WHERE device = v_new.id;
    DELETE FROM device_em.lifetime_counters WHERE device = v_new.id;
    DELETE FROM device_sensor.numeric_15min WHERE device = v_new.id;
    DELETE FROM device_sensor.events WHERE device = v_new.id;

    INSERT INTO device.hardware_replacement_audit (
        organization_id, old_device_id, new_device_id,
        old_external_id, new_external_id, confirmed_by,
        compatibility, mapping
    ) VALUES (
        p_organization_id, v_old.id, v_new.id,
        p_old_external_id, p_new_external_id, p_confirmed_by,
        p_compatibility, COALESCE(p_mapping, '[]'::jsonb)
    )
    RETURNING id INTO v_audit_id;

    DELETE FROM device.list WHERE id = v_new.id;

    RETURN QUERY
    SELECT v_old.id, p_old_external_id, p_new_external_id, v_audit_id;
END;
$$
LANGUAGE plpgsql;

--------------DOWN
-- Forward-only identity migration.
