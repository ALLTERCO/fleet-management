--------------UP
-- Hardware replacement is allowed only against the exact requirement set the
-- operator reviewed. Custom-device bindings consume the physical device just
-- like logical-meter points do, so include every active binding contract in
-- the same transaction fingerprint checked by fn_replace_hardware.
CREATE OR REPLACE FUNCTION device.fn_hardware_requirements_fingerprint(
    p_device_id INTEGER
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    WITH requirements AS (
        SELECT jsonb_build_object(
                   'kind', 'logical_meter_point',
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
        UNION ALL
        SELECT jsonb_build_object(
                   'kind', 'virtual_device_binding',
                   'bindingId', b.id,
                   'virtualDeviceListId', b.virtual_device_list_id,
                   'roleKey', b.role_key,
                   'sourceComponentKey', b.source_component_key,
                   'mode', b.mode,
                   'valueType', b.value_type,
                   'unit', lower(nullif(trim(b.unit), '')),
                   'sourceSnapshot', b.source_snapshot_json,
                   'roleMetadata', b.role_metadata_json,
                   'transform', b.transform_json
               ) AS requirement
          FROM device.virtual_device_binding b
         WHERE b.source_device_list_id = p_device_id
           AND b.effective_to IS NULL
           AND b.effective_from <= NOW()
    )
    SELECT md5(
        COALESCE(
            jsonb_agg(requirement ORDER BY requirement::TEXT),
            '[]'::jsonb
        )::TEXT
    )
      FROM requirements;
$$;

--------------DOWN
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
