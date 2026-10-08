--------------UP
-- Everything an org can still have open, read once so a burst of new devices
-- costs no per-key reads: open alert instances (the same open predicate as
-- fn_alert_open_instance_by_fingerprint) and pending device_offline fire jobs.
-- STABLE, so both parts come from one statement snapshot.
-- Rows: kind 'open' (rule_id, key = fingerprint, id, state), kind
-- 'offline_fire' (rule_id, key = job key), and always one kind 'snapshot' row
-- last: truncated is TRUE when either part passed p_limit, offline_known is
-- FALSE when the graphile_worker jobs view is missing, so callers must not
-- treat an absent job key as "no job".
CREATE OR REPLACE FUNCTION notifications.fn_alert_org_open_snapshot(
    p_organization_id VARCHAR,
    p_limit           INTEGER
)
RETURNS TABLE (
    kind          VARCHAR,
    rule_id       INTEGER,
    key           VARCHAR,
    id            INTEGER,
    state         VARCHAR,
    truncated     BOOLEAN,
    offline_known BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rule_ids      INTEGER[];
    v_open          INTEGER;
    v_offline       INTEGER := 0;
    v_offline_known BOOLEAN := FALSE;
BEGIN
    IF p_organization_id IS NULL OR p_limit IS NULL
       OR p_limit < 1 OR p_limit > 1000000 THEN
        RAISE EXCEPTION 'Invalid alert snapshot request' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(r.id), '{}'::INTEGER[])
      INTO v_rule_ids
      FROM notifications.alert_rules r
     WHERE r.organization_id = p_organization_id;

    RETURN QUERY
    SELECT 'open'::VARCHAR, ai.rule_id, ai.fingerprint::VARCHAR, ai.id,
           ai.state::VARCHAR, NULL::BOOLEAN, NULL::BOOLEAN
      FROM notifications.alert_instances ai
     WHERE ai.rule_id = ANY (v_rule_ids)
       AND ai.organization_id = p_organization_id
       AND ai.resolved_at IS NULL
     LIMIT p_limit + 1;
    GET DIAGNOSTICS v_open = ROW_COUNT;

    -- EXECUTE: this can run before graphile_worker creates its schema.
    IF to_regclass('graphile_worker.jobs') IS NOT NULL THEN
        v_offline_known := TRUE;
        RETURN QUERY EXECUTE
            'SELECT ''offline_fire''::VARCHAR,
                    split_part(j.key, '':'', 2)::INTEGER,
                    j.key::VARCHAR, NULL::INTEGER, NULL::VARCHAR,
                    NULL::BOOLEAN, NULL::BOOLEAN
               FROM graphile_worker.jobs j
              WHERE j.task_identifier = ''device_offline_fire_pending''
                AND j.key LIKE ''device_offline_fire:%''
                AND split_part(j.key, '':'', 2) ~ ''^[0-9]{1,9}$''
                AND split_part(j.key, '':'', 2)::INTEGER = ANY ($1)
              LIMIT $2'
            USING v_rule_ids, p_limit + 1;
        GET DIAGNOSTICS v_offline = ROW_COUNT;
    END IF;

    RETURN QUERY
    SELECT 'snapshot'::VARCHAR, NULL::INTEGER, NULL::VARCHAR, NULL::INTEGER,
           NULL::VARCHAR, (v_open > p_limit OR v_offline > p_limit),
           v_offline_known;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_org_open_snapshot(VARCHAR, INTEGER);
