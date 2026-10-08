--------------UP
-- Groups of many devices of one organization in one call, so a burst of
-- device events costs one round trip. Each device goes through the
-- single-member fn_group_find_by_member, so both keep the same matching rules.
-- One row per distinct device: resolved is FALSE (groups NULL) when the
-- organization has no such device, instead of failing the whole batch.
CREATE OR REPLACE FUNCTION organization.fn_group_find_by_devices(
    p_organization_id VARCHAR,
    p_external_ids    VARCHAR[]
)
RETURNS TABLE (
    external_id VARCHAR,
    resolved    BOOLEAN,
    groups      JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_external_id VARCHAR;
BEGIN
    IF p_organization_id IS NULL OR p_external_ids IS NULL
       OR cardinality(p_external_ids) > 100
       OR array_position(p_external_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid device group lookup batch'
            USING ERRCODE = '22023';
    END IF;
    FOR v_external_id IN
        SELECT DISTINCT input.id FROM unnest(p_external_ids) AS input(id)
         ORDER BY input.id
    LOOP
        external_id := v_external_id;
        BEGIN
            SELECT COALESCE(
                       jsonb_agg(
                           jsonb_build_object('id', m.id, 'name', m.name)
                           ORDER BY m.name, m.id
                       ),
                       '[]'::JSONB
                   )
              INTO groups
              FROM organization.fn_group_find_by_member(
                       p_organization_id, 'device', v_external_id
                   ) m;
            resolved := TRUE;
        EXCEPTION WHEN SQLSTATE '22023' THEN
            -- fn_group_find_by_member raises this for an unknown device.
            resolved := FALSE;
            groups := NULL;
        END;
        RETURN NEXT;
    END LOOP;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_group_find_by_devices(VARCHAR, VARCHAR[]);
