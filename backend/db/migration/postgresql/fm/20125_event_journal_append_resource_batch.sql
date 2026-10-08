--------------UP
SET search_path TO public;

-- Many inventory and group rows in one transaction: the tenant lock is waited
-- for once and released at one commit, instead of once per row. Each row keeps
-- the single-row checks and lands in call order.
CREATE OR REPLACE FUNCTION fm.fn_event_journal_append_resource_batch(
    p_organization_id VARCHAR,
    p_resource_kinds VARCHAR[],
    p_resource_ids VARCHAR[],
    p_event_types VARCHAR[],
    p_user_ids VARCHAR[],
    p_payloads JSONB[],
    p_deduplication_keys VARCHAR[]
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER := coalesce(cardinality(p_resource_ids), 0);
BEGIN
    IF v_count > 1000
        OR coalesce(cardinality(p_resource_kinds), 0) <> v_count
        OR coalesce(cardinality(p_event_types), 0) <> v_count
        OR coalesce(cardinality(p_user_ids), 0) <> v_count
        OR coalesce(cardinality(p_payloads), 0) <> v_count
        OR coalesce(cardinality(p_deduplication_keys), 0) <> v_count THEN
        RAISE EXCEPTION 'event journal batch arrays must match and hold at most 1000 rows'
            USING ERRCODE = '22023';
    END IF;
    FOR i IN 1 .. v_count LOOP
        PERFORM fm.fn_event_journal_append_resource(
            p_organization_id, p_resource_kinds[i], p_resource_ids[i],
            p_event_types[i], p_user_ids[i], p_payloads[i],
            p_deduplication_keys[i]
        );
    END LOOP;
    RETURN v_count;
END;
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS fm.fn_event_journal_append_resource_batch(VARCHAR, VARCHAR[], VARCHAR[], VARCHAR[], VARCHAR[], JSONB[], VARCHAR[]);
