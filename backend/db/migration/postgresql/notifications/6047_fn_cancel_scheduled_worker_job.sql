--------------UP
-- Cancel an unlocked graphile_worker job by key. EXECUTE defers
-- resolution so this migration can precede the first `run()` that
-- creates the graphile_worker schema.
CREATE OR REPLACE FUNCTION notifications.fn_cancel_scheduled_worker_job(
    p_key VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_removed INTEGER;
BEGIN
    BEGIN
        EXECUTE 'SELECT CASE WHEN graphile_worker.remove_job($1) IS NULL THEN 0 ELSE 1 END'
            INTO v_removed
            USING p_key;
        RETURN COALESCE(v_removed, 0);
    EXCEPTION WHEN undefined_table THEN
        -- graphile_worker schema not yet initialized — nothing scheduled.
        RETURN 0;
    WHEN undefined_function THEN
        -- graphile_worker not initialized enough to expose remove_job yet.
        RETURN 0;
    END;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_cancel_scheduled_worker_job;
