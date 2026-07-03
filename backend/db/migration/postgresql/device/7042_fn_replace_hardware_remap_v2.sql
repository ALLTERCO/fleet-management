--------------UP
-- Re-define device.fn_replace_hardware to match remap rows on the point
-- ownership grain (device, channel, tag) ONLY — phase is DISPLAY metadata,
-- not identity (fm/6921_logical_meter_point.sql). The previous 7041 version
-- also matched on phase, so a stored phase differing from the validator's
-- fromPhase matched zero rows: the point was silently skipped while the
-- external_id was still swapped and the temp row deleted, leaving the meter
-- pointing at a (channel, tag) that no longer exists.
--
-- Fail loud: after the remap UPDATE, the applied row count must equal the
-- number of mapping entries. A missed match or a UNIQUE (device, channel,
-- tag) collision (target already owned by a retained point) aborts the whole
-- transaction instead of silently corrupting the meter.
--
-- Channel-swap remaps (e.g. 0->1 and 1->0) hit the non-deferrable UNIQUE
-- mid-UPDATE and abort by design — loud failure, no corruption.
--
-- p_mapping is the normalized array from deviceReplacementMapping.ts:
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
    v_updated INT;
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

    -- Move logical-meter points to the confirmed channels/tags. Match on the
    -- (device, channel, tag) ownership grain only — phase is display metadata.
    -- Keyed on the old device id (preserved), org-scoped through the meter.
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

        -- Fail loud: every entry must update exactly one point. A miss or a
        -- UNIQUE collision aborts the transaction instead of corrupting.
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> jsonb_array_length(p_mapping) THEN
            RAISE EXCEPTION 'hardware remap: expected % point updates, applied %',
                jsonb_array_length(p_mapping), v_updated;
        END IF;
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
-- No-op: additive redefinition. The 7041 version remains the rollback target.
