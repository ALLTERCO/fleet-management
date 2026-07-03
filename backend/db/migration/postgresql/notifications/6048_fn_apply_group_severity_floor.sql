--------------UP
-- Resolve the effective severity floor across every group the alert subject
-- belongs to, then return MAX(proposed, floor). Single entry point for
-- Policy A — callers pass the 4 env-default floors; per-group overrides
-- read from groups.metadata.policy.severityFloor.
CREATE OR REPLACE FUNCTION notifications.fn_apply_group_severity_floor(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_proposed        VARCHAR,
    p_default_standard    VARCHAR DEFAULT NULL,
    p_default_operational VARCHAR DEFAULT NULL,
    p_default_critical    VARCHAR DEFAULT NULL,
    p_default_custom      VARCHAR DEFAULT NULL
)
RETURNS VARCHAR
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_floor_rank INTEGER;
    v_proposed_rank INTEGER;
    -- Coupled with ALERT_SEVERITIES (backend/src/types/api/alert.ts).
    -- Both sides must list the same values in the same rank order.
    v_levels CONSTANT VARCHAR[] := ARRAY['info','warning','critical'];
BEGIN
    v_proposed_rank := array_position(v_levels, p_proposed);
    IF v_proposed_rank IS NULL THEN
        RETURN p_proposed;  -- unknown severity passes through untouched
    END IF;

    -- Every group the subject touches: direct group match, or device /
    -- entity / location membership. MAX over their resolved floors.
    WITH touched_groups AS (
        SELECT g.group_type, g.metadata
        FROM organization.groups g
        JOIN organization.group_members gm
          ON gm.group_id = g.id
         AND gm.organization_id = g.organization_id
        WHERE g.organization_id = p_organization_id
          AND (
              (p_subject_type = 'device' AND gm.subject_type = 'device'
                   AND gm.subject_id = p_subject_id)
              OR (p_subject_type = 'entity' AND gm.subject_type = 'entity'
                   AND gm.subject_id = p_subject_id)
              OR (p_subject_type = 'entity' AND gm.subject_type = 'device'
                   AND organization.fn_entity_belongs_to_device(
                       p_subject_id, ARRAY[gm.subject_id]::VARCHAR[]))
              OR (p_subject_type = 'location' AND gm.subject_type = 'location'
                   AND gm.subject_id = p_subject_id)
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
            CASE group_type
                WHEN 'standard'    THEN p_default_standard
                WHEN 'operational' THEN p_default_operational
                WHEN 'critical'    THEN p_default_critical
                WHEN 'custom'      THEN p_default_custom
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
DROP FUNCTION notifications.fn_apply_group_severity_floor;
