--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_open_instances_by_fingerprints(
    p_organization_id VARCHAR,
    p_rule_id INTEGER,
    p_fingerprints VARCHAR[]
)
RETURNS TABLE (fingerprint VARCHAR, id INTEGER, state VARCHAR)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_fingerprints IS NULL OR cardinality(p_fingerprints) > 32
       OR array_position(p_fingerprints, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid alert fingerprint batch' USING ERRCODE = '22023';
    END IF;
    -- Reuse the canonical open-row predicate and the statement snapshot.
    RETURN QUERY
    SELECT requested.fingerprint, ai.id, ai.state
      FROM (SELECT DISTINCT unnest(p_fingerprints) AS fingerprint) requested
      CROSS JOIN LATERAL notifications.fn_alert_open_instance_by_fingerprint(
          p_organization_id, p_rule_id, requested.fingerprint
      ) ai;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_open_instances_by_fingerprints(VARCHAR, INTEGER, VARCHAR[]);
