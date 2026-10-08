--------------UP
ALTER TABLE device.hardware_replacement_audit
    ADD COLUMN IF NOT EXISTS binding_mapping JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION device.fn_hardware_candidate_fingerprint(
    p_device_id INTEGER
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT md5(
        jsonb_build_object(
            'jdoc', COALESCE(candidate.jdoc, '{}'::jsonb),
            'energyMeasurementPoints', COALESCE(
                (
                    SELECT jsonb_agg(point ORDER BY point::TEXT)
                      FROM (
                          SELECT DISTINCT jsonb_build_object(
                                     'channel', energy.channel,
                                     'phase', energy.phase,
                                     'tag', energy.tag,
                                     'domain', energy.domain
                                 ) AS point
                            FROM device_em.energy_15min energy
                           WHERE energy.device = candidate.id
                      ) points
                ),
                '[]'::jsonb
            )
        )::TEXT
    )
      FROM device.list candidate
     WHERE candidate.id = p_device_id;
$$;

-- Nine-argument replacement is the application entry point. It validates the
-- reviewed fingerprint under the same locks as the identity swap, creates a
-- new binding generation for every confirmed component remap, then delegates
-- the physical identity/ownership swap to the seven-argument SSOT function.
CREATE OR REPLACE FUNCTION device.fn_replace_hardware(
    p_organization_id VARCHAR,
    p_old_external_id VARCHAR,
    p_new_external_id VARCHAR,
    p_confirmed_by VARCHAR,
    p_compatibility VARCHAR,
    p_mapping JSONB,
    p_requirements_fingerprint TEXT,
    p_binding_mapping JSONB,
    p_candidate_fingerprint TEXT
)
RETURNS TABLE (
    device_id INT,
    old_external_id VARCHAR,
    new_external_id VARCHAR,
    audit_id BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_device_id INTEGER;
    v_new_device_id INTEGER;
    v_current_fingerprint TEXT;
    v_post_remap_fingerprint TEXT;
    v_current_candidate_fingerprint TEXT;
    v_effective_at TIMESTAMPTZ;
    v_map JSONB;
    v_old_binding device.virtual_device_binding%ROWTYPE;
    v_new_binding_id UUID;
    v_result RECORD;
BEGIN
    IF jsonb_typeof(COALESCE(p_binding_mapping, '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'binding mapping must be an array';
    END IF;

    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;

    SELECT id INTO v_old_device_id
      FROM device.list
     WHERE external_id = p_old_external_id
       AND organization_id = p_organization_id
     FOR UPDATE;
    IF v_old_device_id IS NULL THEN
        RAISE EXCEPTION 'old device % not found in organization %',
            p_old_external_id, p_organization_id;
    END IF;

    SELECT id INTO v_new_device_id
      FROM device.list
     WHERE external_id = p_new_external_id
       AND organization_id = p_organization_id
     FOR UPDATE;
    IF v_new_device_id IS NULL THEN
        RAISE EXCEPTION 'new device % not found in organization %',
            p_new_external_id, p_organization_id;
    END IF;

    -- Measurement-point history participates in candidate compatibility.
    -- Prevent a new or changed point from appearing between this check and
    -- the identity swap; device.list rows are already locked above.
    LOCK TABLE device_em.energy_15min IN SHARE MODE;
    SELECT device.fn_hardware_candidate_fingerprint(v_new_device_id)
      INTO v_current_candidate_fingerprint;
    IF v_current_candidate_fingerprint IS DISTINCT FROM p_candidate_fingerprint THEN
        RAISE EXCEPTION 'hardware replacement candidate changed; check again';
    END IF;

    PERFORM pg_advisory_xact_lock(73002, v_old_device_id);
    SELECT device.fn_hardware_requirements_fingerprint(v_old_device_id)
      INTO v_current_fingerprint;
    IF v_current_fingerprint IS DISTINCT FROM p_requirements_fingerprint THEN
        RAISE EXCEPTION 'hardware replacement requirements changed; check again';
    END IF;

    -- Lock and validate every generation before choosing the common boundary.
    -- The second pass performs the writes, so all retired/new generations use
    -- exactly one timestamp and no partial remap can move the boundary.
    FOR v_map IN
        SELECT value FROM jsonb_array_elements(
            COALESCE(p_binding_mapping, '[]'::jsonb)
        )
        ORDER BY value ->> 'bindingId'
    LOOP
        SELECT * INTO v_old_binding
          FROM device.virtual_device_binding
         WHERE id = (v_map ->> 'bindingId')::UUID
           AND organization_id = p_organization_id
           AND source_device_list_id = v_old_device_id
           AND source_component_key = v_map ->> 'fromComponentKey'
           AND effective_to IS NULL
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'active custom binding % changed; check again',
                v_map ->> 'bindingId';
        END IF;

    END LOOP;

    v_effective_at := clock_timestamp();

    FOR v_map IN
        SELECT value FROM jsonb_array_elements(
            COALESCE(p_binding_mapping, '[]'::jsonb)
        )
        ORDER BY value ->> 'bindingId'
    LOOP
        SELECT * INTO v_old_binding
          FROM device.virtual_device_binding
         WHERE id = (v_map ->> 'bindingId')::UUID
           AND organization_id = p_organization_id
           AND source_device_list_id = v_old_device_id
           AND source_component_key = v_map ->> 'fromComponentKey'
           AND effective_to IS NULL;

        UPDATE device.virtual_device_binding
           SET effective_to = v_effective_at,
               retired_by = p_confirmed_by,
               retired_reason = 'hardware replacement component remap'
         WHERE id = v_old_binding.id;

        v_new_binding_id := gen_random_uuid();
        INSERT INTO device.virtual_device_binding (
            id, virtual_device_list_id, organization_id, role_key,
            source_device_list_id, source_component_key,
            source_dynamic_category, mode, transform_json,
            effective_from, created_by, value_type, writable, required,
            unit, source_snapshot_json, role_metadata_json, visual_json
        ) VALUES (
            v_new_binding_id,
            v_old_binding.virtual_device_list_id,
            v_old_binding.organization_id,
            v_old_binding.role_key,
            v_old_binding.source_device_list_id,
            v_map ->> 'toComponentKey',
            v_old_binding.source_dynamic_category,
            v_old_binding.mode,
            v_old_binding.transform_json,
            v_effective_at,
            p_confirmed_by,
            v_old_binding.value_type,
            v_old_binding.writable,
            v_old_binding.required,
            v_old_binding.unit,
            COALESCE(v_map -> 'sourceSnapshot', v_old_binding.source_snapshot_json),
            v_old_binding.role_metadata_json,
            v_old_binding.visual_json
        );

        INSERT INTO device.virtual_device_binding_event (
            id, binding_id, virtual_device_list_id, event_type,
            old_source_json, new_source_json, actor_id, reason
        ) VALUES (
            gen_random_uuid(), v_new_binding_id,
            v_old_binding.virtual_device_list_id, 'replace',
            jsonb_build_object(
                'deviceExternalId', p_old_external_id,
                'componentKey', v_old_binding.source_component_key
            ),
            jsonb_build_object(
                'deviceExternalId', p_new_external_id,
                'componentKey', v_map ->> 'toComponentKey'
            ),
            p_confirmed_by, 'hardware replacement component remap'
        );

        UPDATE device.virtual_device
           SET revision = revision + 1,
               updated_at = clock_timestamp()
         WHERE device_list_id = v_old_binding.virtual_device_list_id
           AND organization_id = p_organization_id;
    END LOOP;

    -- The delegated function rechecks under the same transaction lock. Its
    -- expected fingerprint is the post-generation value, so both checks fail
    -- closed if requirements change before or during this transaction.
    SELECT device.fn_hardware_requirements_fingerprint(v_old_device_id)
      INTO v_post_remap_fingerprint;
    SELECT * INTO v_result
      FROM device.fn_replace_hardware(
          p_organization_id,
          p_old_external_id,
          p_new_external_id,
          p_confirmed_by,
          p_compatibility,
          COALESCE(p_mapping, '[]'::jsonb),
          v_post_remap_fingerprint
      );

    UPDATE device.hardware_replacement_audit
       SET binding_mapping = COALESCE(p_binding_mapping, '[]'::jsonb)
     WHERE id = v_result.audit_id;

    RETURN QUERY SELECT
        v_result.device_id::INT,
        v_result.old_external_id::VARCHAR,
        v_result.new_external_id::VARCHAR,
        v_result.audit_id::BIGINT;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_replace_hardware(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TEXT, JSONB, TEXT
);
DROP FUNCTION IF EXISTS device.fn_hardware_candidate_fingerprint(INTEGER);
ALTER TABLE device.hardware_replacement_audit
    DROP COLUMN IF EXISTS binding_mapping;
