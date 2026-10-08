--------------UP
-- One canonical SQL projection of an energy role. Both raw and retained
-- report relations consume it, so channel, lifetime, transform and units
-- cannot drift between report paths.
CREATE OR REPLACE VIEW device.virtual_energy_binding_projection AS
WITH binding_semantics AS (
    SELECT
        b.*,
        split_part(b.source_component_key, ':', 1) AS component_type,
        lower(COALESCE(
            b.role_metadata_json ->> 'historyField',
            b.role_metadata_json ->> 'metric',
            b.role_metadata_json ->> 'tag',
            b.role_metadata_json ->> 'componentType',
            b.source_snapshot_json ->> 'objName',
            b.role_key
        )) AS semantic_role,
        lower(COALESCE(b.unit, '')) AS normalized_unit
      FROM device.virtual_device_binding b
), resolved AS (
    SELECT
        binding_semantics.*,
        CASE
            WHEN component_type IN ('emdata', 'em1data') THEN
                CASE
                    WHEN semantic_role LIKE '%returned%' OR semantic_role LIKE '%export%'
                    THEN 'total_act_ret_energy'
                    ELSE 'total_act_energy'
                END
            WHEN component_type = 'currentmonitor' THEN 'current'
            WHEN component_type = 'voltmeter' THEN 'voltage'
            WHEN component_type IN ('em', 'em1', 'pm1') OR (
                component_type IN (
                    'switch', 'light', 'cover', 'rgb', 'rgbw', 'cct', 'rgbcct',
                    'bthomesensor'
                ) AND (
                    normalized_unit IN ('w', 'kw', 'va', 'kva', 'v', 'a', 'hz', 'wh', 'kwh') OR
                    semantic_role ~ '(power|energy|consumption|voltage|current|frequency|returned|export)'
                )
            ) THEN
                CASE
                    WHEN normalized_unit IN ('w', 'kw') THEN 'power'
                    WHEN normalized_unit IN ('va', 'kva') THEN 'apparent_power'
                    WHEN normalized_unit = 'v' THEN 'voltage'
                    WHEN normalized_unit = 'a' THEN 'current'
                    WHEN normalized_unit = 'hz' THEN 'frequency'
                    WHEN normalized_unit IN ('wh', 'kwh') THEN
                        CASE
                            WHEN semantic_role LIKE '%returned%' OR semantic_role LIKE '%export%'
                            THEN 'total_act_ret_energy'
                            ELSE 'total_act_energy'
                        END
                    WHEN semantic_role LIKE '%voltage%' THEN 'voltage'
                    WHEN semantic_role LIKE '%current%' THEN 'current'
                    WHEN semantic_role LIKE '%apparent%' THEN 'apparent_power'
                    WHEN semantic_role LIKE '%frequency%' THEN 'frequency'
                    WHEN semantic_role LIKE '%power_factor%' THEN 'power_factor'
                    WHEN semantic_role LIKE '%returned%' OR semantic_role LIKE '%export%'
                    THEN 'total_act_ret_energy'
                    WHEN semantic_role LIKE '%energy%' OR semantic_role LIKE '%consumption%'
                    THEN 'total_act_energy'
                    ELSE 'power'
                END
        END AS inferred_projection_field
      FROM binding_semantics
)
SELECT
    b.id,
    b.organization_id,
    b.virtual_device_list_id,
    b.source_device_list_id,
    b.source_component_key,
    b.source_dynamic_category,
    b.mode,
    b.unit,
    b.effective_from,
    b.effective_to,
    COALESCE(
        b.role_metadata_json #>> '{projection,field}',
        b.inferred_projection_field
    ) AS projection_field,
    COALESCE(
        (b.role_metadata_json #>> '{projection,transform,factor}')::double precision,
        (b.transform_json ->> 'factor')::double precision,
        CASE
            WHEN b.inferred_projection_field IN (
                'total_act_energy', 'total_act_ret_energy'
            ) AND b.normalized_unit = 'kwh' AND b.component_type <> 'bthomesensor'
            THEN 0.001::double precision
            ELSE 1::double precision
        END
    ) AS scale_factor,
    COALESCE(
        (b.role_metadata_json #>> '{projection,transform,offset}')::double precision,
        (b.transform_json ->> 'offset')::double precision,
        0::double precision
    ) AS offset_value,
    split_part(b.source_component_key, ':', 2)::smallint AS source_channel
  FROM resolved b
  JOIN device.virtual_device vd
    ON vd.device_list_id = b.virtual_device_list_id
   AND vd.organization_id = b.organization_id
   AND vd.deleted_at IS NULL
 WHERE b.role_metadata_json #>> '{projection,series}' = 'energy'
    OR (
        b.role_metadata_json -> 'projection' IS NULL AND
        b.inferred_projection_field IS NOT NULL
    );

-- Finer-than-rollup interval exports use the same logical identity model.
CREATE OR REPLACE VIEW device_em.logical_stats AS
WITH linked_rows AS (
    SELECT DISTINCT
        source.ts,
        source.channel,
        CASE
            WHEN source.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN source.val::double precision * binding.scale_factor *
                CASE
                    WHEN lower(COALESCE(binding.unit, '')) = 'kwh' AND
                         binding.source_dynamic_category IS DISTINCT FROM 'BTHome'
                    THEN 1000 ELSE 1
                END
            ELSE source.val::double precision * binding.scale_factor + binding.offset_value
        END AS val,
        source.phase,
        binding.virtual_device_list_id AS device,
        source.tag,
        source.domain,
        source.classifier_source,
        source.source,
        source.commodity,
        source.electrical_source
      FROM device_em.stats source
      JOIN device.virtual_energy_binding_projection binding
        ON binding.mode = 'linked'
       AND binding.source_device_list_id = source.device
       AND binding.source_channel = COALESCE(source.channel, 0)
       AND source.ts >= binding.effective_from
       AND source.ts < COALESCE(binding.effective_to, 'infinity'::timestamptz)
       AND (
            (binding.projection_field = 'voltage' AND source.tag IN ('voltage', 'min_voltage', 'max_voltage')) OR
            (binding.projection_field = 'current' AND source.tag IN ('current', 'min_current', 'max_current')) OR
            source.tag = binding.projection_field
       )
), projected_rows AS (
    SELECT
        sample.ts,
        binding.source_channel AS channel,
        CASE
            WHEN sample.field IN ('total_act_energy', 'total_act_ret_energy')
            THEN CASE
                WHEN jsonb_typeof(sample.prev_value) = 'number' AND
                     (sample.value #>> '{}')::double precision >
                     (sample.prev_value #>> '{}')::double precision
                THEN (
                    (sample.value #>> '{}')::double precision -
                    (sample.prev_value #>> '{}')::double precision
                ) * CASE
                    WHEN lower(COALESCE(binding.unit, '')) = 'kwh' THEN 1000
                    ELSE 1
                END
            END
            ELSE (sample.value #>> '{}')::double precision
        END AS val,
        NULL::varchar(1) AS phase,
        sample.virtual_device_list_id AS device,
        mapped.tag::varchar(30) AS tag,
        'ac_mains'::varchar(16) AS domain,
        'virtual_projection'::varchar(16) AS classifier_source,
        'virtual_projection'::varchar(16) AS source,
        'electricity'::varchar(12) AS commodity,
        'ac_mains'::varchar(16) AS electrical_source
      FROM device.virtual_device_projected_sample sample
      JOIN device.virtual_energy_binding_projection binding
        ON binding.id = sample.binding_id
       AND binding.mode IN ('materialized', 'derived')
     CROSS JOIN LATERAL (
        SELECT unnest(
            CASE sample.field
                WHEN 'voltage' THEN ARRAY['voltage', 'min_voltage', 'max_voltage']
                WHEN 'current' THEN ARRAY['current', 'min_current', 'max_current']
                ELSE ARRAY[sample.field]
            END
        ) AS tag
     ) mapped
     WHERE sample.series = 'energy'
       AND jsonb_typeof(sample.value) = 'number'
)
SELECT
    physical.ts,
    physical.channel,
    physical.val::double precision AS val,
    physical.phase,
    physical.device,
    physical.tag,
    physical.domain,
    physical.classifier_source,
    physical.source,
    physical.commodity,
    physical.electrical_source
  FROM device_em.stats physical
UNION ALL
SELECT * FROM linked_rows
UNION ALL
SELECT * FROM projected_rows;

-- Long-term reports read retained 15-minute rows under the same identity.
CREATE OR REPLACE VIEW device_em.logical_energy_15min AS
WITH linked_rows AS (
    SELECT DISTINCT
        source.bucket,
        binding.virtual_device_list_id AS device,
        source.phase,
        source.channel,
        source.tag,
        source.domain,
        CASE
            WHEN source.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN source.sum_val * binding.scale_factor *
                CASE
                    WHEN lower(COALESCE(binding.unit, '')) = 'kwh' AND
                         binding.source_dynamic_category IS DISTINCT FROM 'BTHome'
                    THEN 1000 ELSE 1
                END
            ELSE source.sum_val * binding.scale_factor +
                binding.offset_value * source.sample_count
        END AS sum_val,
        source.sample_count,
        source.min_val * binding.scale_factor + binding.offset_value AS min_val,
        source.max_val * binding.scale_factor + binding.offset_value AS max_val,
        source.commodity,
        source.electrical_source
      FROM device_em.energy_15min source
      JOIN device.virtual_energy_binding_projection binding
        ON binding.mode = 'linked'
       AND binding.source_device_list_id = source.device
       AND binding.source_channel = COALESCE(source.channel, 0)
       AND source.bucket >= binding.effective_from
       AND source.bucket < COALESCE(binding.effective_to, 'infinity'::timestamptz)
       AND (
            (binding.projection_field = 'voltage' AND source.tag IN ('voltage', 'min_voltage', 'max_voltage')) OR
            (binding.projection_field = 'current' AND source.tag IN ('current', 'min_current', 'max_current')) OR
            source.tag = binding.projection_field
       )
), projected_numeric AS (
    SELECT
        time_bucket(INTERVAL '15 minutes', sample.ts) AS bucket,
        sample.virtual_device_list_id AS device,
        binding.source_channel AS channel,
        sample.field,
        SUM(
            CASE
                WHEN sample.field IN ('total_act_energy', 'total_act_ret_energy')
                THEN CASE
                    WHEN jsonb_typeof(sample.prev_value) = 'number' AND
                         (sample.value #>> '{}')::double precision >
                         (sample.prev_value #>> '{}')::double precision
                    THEN (sample.value #>> '{}')::double precision -
                         (sample.prev_value #>> '{}')::double precision
                END
                ELSE (sample.value #>> '{}')::double precision
            END
        ) AS sum_val,
        COUNT(*) FILTER (WHERE jsonb_typeof(sample.value) = 'number') AS sample_count,
        MIN((sample.value #>> '{}')::double precision) AS min_val,
        MAX((sample.value #>> '{}')::double precision) AS max_val,
        binding.unit
      FROM device.virtual_device_projected_sample sample
      JOIN device.virtual_energy_binding_projection binding
        ON binding.id = sample.binding_id
     WHERE sample.series = 'energy'
       AND binding.mode IN ('materialized', 'derived')
       AND jsonb_typeof(sample.value) = 'number'
     GROUP BY 1, 2, 3, 4, binding.unit
), projected_rows AS (
    SELECT
        projected.bucket,
        projected.device,
        NULL::varchar(1) AS phase,
        projected.channel,
        mapped.tag::varchar(30) AS tag,
        'ac_mains'::varchar(16) AS domain,
        CASE
            WHEN projected.field IN ('total_act_energy', 'total_act_ret_energy')
            THEN projected.sum_val *
                CASE WHEN lower(COALESCE(projected.unit, '')) = 'kwh' THEN 1000 ELSE 1 END
            ELSE projected.sum_val
        END AS sum_val,
        projected.sample_count,
        projected.min_val,
        projected.max_val,
        'electricity'::varchar(12) AS commodity,
        'ac_mains'::varchar(16) AS electrical_source
      FROM projected_numeric projected
     CROSS JOIN LATERAL (
        SELECT unnest(
            CASE projected.field
                WHEN 'voltage' THEN ARRAY['voltage', 'min_voltage', 'max_voltage']
                WHEN 'current' THEN ARRAY['current', 'min_current', 'max_current']
                ELSE ARRAY[projected.field]
            END
        ) AS tag
     ) mapped
)
SELECT
    physical.bucket,
    physical.device,
    physical.phase,
    physical.channel,
    physical.tag,
    physical.domain,
    physical.sum_val,
    physical.sample_count,
    physical.min_val,
    physical.max_val,
    physical.commodity,
    physical.electrical_source
  FROM device_em.energy_15min physical
UNION ALL
SELECT * FROM linked_rows
UNION ALL
SELECT * FROM projected_rows;

--------------DOWN
DROP VIEW IF EXISTS device_em.logical_energy_15min;
DROP VIEW IF EXISTS device_em.logical_stats;
DROP VIEW IF EXISTS device.virtual_energy_binding_projection;
