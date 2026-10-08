--------------UP
-- Cancel many unlocked graphile_worker jobs by key in one call, so a burst of
-- reconnecting devices costs one round trip. Same rules as the single-key
-- fn_cancel_scheduled_worker_job: the public remove_job API per key, through
-- EXECUTE so this can run before graphile_worker creates its schema. Keys are
-- taken in sorted order so concurrent batches lock rows in the same order.
CREATE OR REPLACE FUNCTION notifications.fn_cancel_scheduled_worker_jobs(
    p_keys VARCHAR[]
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_key VARCHAR;
    v_one INTEGER;
    v_removed INTEGER := 0;
BEGIN
    IF p_keys IS NULL OR cardinality(p_keys) > 500
       OR array_position(p_keys, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid worker job key batch' USING ERRCODE = '22023';
    END IF;
    BEGIN
        FOR v_key IN SELECT DISTINCT k FROM unnest(p_keys) AS k ORDER BY k LOOP
            EXECUTE 'SELECT CASE WHEN graphile_worker.remove_job($1) IS NULL THEN 0 ELSE 1 END'
                INTO v_one
                USING v_key;
            v_removed := v_removed + COALESCE(v_one, 0);
        END LOOP;
        RETURN v_removed;
    EXCEPTION WHEN undefined_table THEN
        -- graphile_worker schema not yet initialized; nothing scheduled.
        RETURN 0;
    WHEN undefined_function THEN
        -- graphile_worker not initialized enough to expose remove_job yet.
        RETURN 0;
    END;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_cancel_scheduled_worker_jobs(VARCHAR[]);
