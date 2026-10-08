--------------UP
-- A custom device bound to an EM channel shows every tag of that channel's
-- 1-minute record, not only the bound field. The coverage rule is one function
-- (fn_projection_field_covers) that both logical views and the represented-
-- channel scope of 20163 already call, so the views now call it too. Folding
-- over time stays with device_em.fn_stats_tag_aggregation (20177).
--   power           also min_power, max_power
--   apparent_power  also min_apparent_power, max_apparent_power, power_factor
--   current         also neutral_current, min_neutral_current and
--                   max_neutral_current, only when the binding is a whole
--                   3-phase meter (component em); a single-phase channel
--                   (em1, pm1, switch) gets none, because the neutral line
--                   belongs to the meter, not to one phase (stored on 'z')
--   energy fields   fund_*, lag_react_energy and lead_react_energy follow the
--                   active energy (total_act_energy, total_act_ret_energy)
-- Record energy tags are scaled like total energy (kWh binding, Wh storage).
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_projection_field_covers(
    p_field TEXT,
    p_tag   TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (p_field = 'voltage' AND p_tag IN ('voltage', 'min_voltage', 'max_voltage'))
        OR (p_field = 'current' AND p_tag IN ('current', 'min_current', 'max_current'))
        OR (p_field = 'current_meter' AND p_tag IN ('current', 'min_current', 'max_current',
                                                    'neutral_current', 'min_neutral_current',
                                                    'max_neutral_current'))
        OR (p_field = 'power' AND p_tag IN ('power', 'min_power', 'max_power'))
        OR (p_field = 'apparent_power' AND p_tag IN ('apparent_power', 'min_apparent_power',
                                                      'max_apparent_power', 'power_factor'))
        OR (p_field = 'total_act_energy' AND p_tag IN ('total_act_energy', 'fund_act_energy',
                                                        'lag_react_energy', 'lead_react_energy'))
        OR (p_field = 'total_act_ret_energy' AND p_tag IN ('total_act_ret_energy', 'fund_act_ret_energy'))
        OR p_tag = p_field;
$$;

-- A binding of a whole 3-phase meter (em:N) covers every phase of that source
-- device, so its current field also carries the meter's neutral line.
CREATE OR REPLACE FUNCTION device_em.fn_binding_coverage_field(
    p_field         TEXT,
    p_component_key TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_field = 'current' AND split_part(p_component_key, ':', 1) = 'em'
        THEN 'current_meter'
        ELSE p_field
    END;
$$;

-- Same rows as 20163, with the coverage field of the binding's component.
CREATE OR REPLACE FUNCTION device_em.fn_represented_energy_sources(
    p_owners  INTEGER[],
    p_sources INTEGER[]
)
RETURNS TABLE (
    source_device    INTEGER,
    source_channel   SMALLINT,
    projection_field TEXT,
    effective_from   TIMESTAMP WITH TIME ZONE,
    effective_until  TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
AS $$
    SELECT b.source_device_list_id,
           b.source_channel,
           device_em.fn_binding_coverage_field(b.projection_field, b.source_component_key),
           b.effective_from,
           COALESCE(b.effective_to, 'infinity'::timestamptz)
      FROM device.virtual_energy_binding_projection b
     WHERE b.virtual_device_list_id = ANY(p_owners)
       AND b.source_device_list_id = ANY(p_sources);
$$;

-- Finer-than-rollup interval exports use the same logical identity model.
CREATE OR REPLACE VIEW device_em.logical_stats AS
WITH linked_rows AS (
    SELECT DISTINCT
        source.ts,
        source.channel,
        CASE
            WHEN source.tag IN ('total_act_energy', 'total_act_ret_energy', 'fund_act_energy', 'fund_act_ret_energy', 'lag_react_energy', 'lead_react_energy')
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
       AND device_em.fn_projection_field_covers(
                device_em.fn_binding_coverage_field(binding.projection_field, binding.source_component_key),
                source.tag)
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
            WHEN source.tag IN ('total_act_energy', 'total_act_ret_energy', 'fund_act_energy', 'fund_act_ret_energy', 'lag_react_energy', 'lead_react_energy')
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
       AND device_em.fn_projection_field_covers(
                device_em.fn_binding_coverage_field(binding.projection_field, binding.source_component_key),
                source.tag)
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
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_projection_field_covers(
    p_field TEXT,
    p_tag   TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (p_field = 'voltage' AND p_tag IN ('voltage', 'min_voltage', 'max_voltage'))
        OR (p_field = 'current' AND p_tag IN ('current', 'min_current', 'max_current'))
        OR p_tag = p_field;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_represented_energy_sources(
    p_owners  INTEGER[],
    p_sources INTEGER[]
)
RETURNS TABLE (
    source_device    INTEGER,
    source_channel   SMALLINT,
    projection_field TEXT,
    effective_from   TIMESTAMP WITH TIME ZONE,
    effective_until  TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
AS $$
    SELECT b.source_device_list_id,
           b.source_channel,
           b.projection_field,
           b.effective_from,
           COALESCE(b.effective_to, 'infinity'::timestamptz)
      FROM device.virtual_energy_binding_projection b
     WHERE b.virtual_device_list_id = ANY(p_owners)
       AND b.source_device_list_id = ANY(p_sources);
$$;

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

DROP FUNCTION IF EXISTS device_em.fn_binding_coverage_field(TEXT, TEXT);
