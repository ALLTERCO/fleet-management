--------------UP
-- Re-define device.fn_replace_hardware to also apply a compatible point
-- remap. The old behavior (keep the old Fleet device id, swap external_id,
-- delete the temporary new row, audit) is unchanged. For compatible_mapping
-- the function additionally moves the affected fm.logical_meter_point rows
-- from their old (channel, phase, tag) to the confirmed new target, so the
-- logical meters keep reading the same physical quantities on the new
-- hardware. The device internal id stays the same, so the point.device
-- reference does not change — only channel/phase/tag move.
--
-- p_mapping is the normalized array produced by deviceReplacementMapping.ts:
--   [{fromChannel, fromPhase, fromTag, toChannel, toPhase, toTag}, ...]
-- For exact_match it is an empty array and no points are touched.
CREATE OR REPLACE FUNCTION device.fn_replace_hardware(
    p_organization_id VARCHAR,
    p_old_external_id VARCHAR,
    p_new_external_id VARCHAR,
    p_confirmed_by VARCHAR,
    p_compatibility VARCHAR,
    p_mapping JSONB
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

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    SELECT *
      INTO v_old
      FROM device.list
     WHERE external_id = p_old_external_id
       AND organization_id = p_organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'old device % not found in organization %',
            p_old_external_id, p_organization_id;
    END IF;

    SELECT *
      INTO v_new
      FROM device.list
     WHERE external_id = p_new_external_id
       AND organization_id = p_organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'new device % not found in organization %',
            p_new_external_id, p_organization_id;
    END IF;

    -- Move logical-meter points to the confirmed channels/tags. Keyed on the
    -- old device id (which is preserved), org-scoped through the meter. The
    -- caller has already validated each entry against the allowed candidates.
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
           AND lmp.phase = m->>'fromPhase'
           AND lmp.tag = m->>'fromTag'
           AND lmp.logical_meter_id IN (
               SELECT id FROM fm.logical_meter
                WHERE organization_id = p_organization_id
           );
    END IF;

    DELETE FROM device.list
     WHERE id = v_new.id;

    UPDATE device.list
       SET external_id = p_new_external_id,
           jdoc = COALESCE(v_new.jdoc, v_old.jdoc),
           control_access = v_new.control_access,
           updated = now()::TIMESTAMPTZ
     WHERE id = v_old.id;

    INSERT INTO device.hardware_replacement_audit (
        organization_id, old_device_id, new_device_id,
        old_external_id, new_external_id, confirmed_by,
        compatibility, mapping
    )
    VALUES (
        p_organization_id, v_old.id, v_new.id,
        p_old_external_id, p_new_external_id, p_confirmed_by,
        p_compatibility, COALESCE(p_mapping, '[]'::jsonb)
    )
    RETURNING id INTO v_audit_id;

    RETURN QUERY
    SELECT v_old.id, p_old_external_id, p_new_external_id, v_audit_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
-- No-op: additive redefinition. The base function from
-- device/7040_hardware_replacement.sql remains the rollback target.
