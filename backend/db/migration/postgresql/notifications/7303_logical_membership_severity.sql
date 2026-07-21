--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_apply_group_severity_floor(
    p_organization_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR,
    p_proposed VARCHAR,
    p_default_standard VARCHAR DEFAULT NULL,
    p_default_operational VARCHAR DEFAULT NULL,
    p_default_critical VARCHAR DEFAULT NULL,
    p_default_custom VARCHAR DEFAULT NULL
)
RETURNS VARCHAR
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_floor_rank INTEGER;
    v_proposed_rank INTEGER;
    v_levels CONSTANT VARCHAR[] := ARRAY['info', 'warning', 'critical'];
BEGIN
    v_proposed_rank := array_position(v_levels, p_proposed);
    IF v_proposed_rank IS NULL THEN RETURN p_proposed; END IF;

    WITH subject AS (
        SELECT normalized.device_id,
               normalized.subject_id,
               normalized.entity_suffix
          FROM organization.fn_normalize_subject_reference(
              p_organization_id, p_subject_type, p_subject_id
          ) normalized
    ),
    touched_groups AS (
        SELECT g.group_type, g.metadata
          FROM organization.groups g
          JOIN organization.group_members gm
            ON gm.group_id = g.id
           AND gm.organization_id = g.organization_id
          CROSS JOIN subject s
         WHERE g.organization_id = p_organization_id
           AND (
               (p_subject_type = 'device'
                   AND gm.subject_type = 'device'
                   AND gm.device_id = s.device_id)
               OR (p_subject_type = 'entity'
                   AND gm.subject_type = 'entity'
                   AND (
                       (s.device_id IS NOT NULL
                           AND gm.device_id = s.device_id
                           AND gm.entity_suffix = s.entity_suffix)
                       OR (s.device_id IS NULL
                           AND gm.subject_id = s.subject_id)
                   ))
               OR (p_subject_type = 'entity'
                   AND s.device_id IS NOT NULL
                   AND gm.subject_type = 'device'
                   AND gm.device_id = s.device_id)
               OR (p_subject_type = 'location'
                   AND gm.subject_type = 'location'
                   AND gm.subject_id = s.subject_id)
           )
        UNION
        SELECT g.group_type, g.metadata
          FROM organization.groups g
         WHERE p_subject_type = 'group'
           AND g.organization_id = p_organization_id
           AND g.id::VARCHAR = p_subject_id
    ),
    resolved AS (
        SELECT COALESCE(
            metadata->'policy'->>'severityFloor',
            (
                SELECT p.value
                  FROM organization.group_type_policy p
                 WHERE p.group_type = touched_groups.group_type
                   AND p.field_key = 'severity_floor'
            ),
            CASE group_type
                WHEN 'standard' THEN p_default_standard
                WHEN 'operational' THEN p_default_operational
                WHEN 'critical' THEN p_default_critical
                WHEN 'custom' THEN p_default_custom
            END
        ) AS floor_level
          FROM touched_groups
    )
    SELECT MAX(array_position(v_levels, floor_level))
      INTO v_floor_rank
      FROM resolved
     WHERE floor_level IS NOT NULL;

    IF v_floor_rank IS NULL OR v_floor_rank <= v_proposed_rank THEN
        RETURN p_proposed;
    END IF;
    RETURN v_levels[v_floor_rank];
END;
$$;

--------------DOWN
-- Forward-only logical identity migration.
