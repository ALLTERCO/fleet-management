--------------UP
-- Release a claimed job back to 'queued' without bumping attempts.
-- Worker calls this when an endpoint is in quiet hours so graphile-worker
-- can retry on its normal backoff.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_release(
    p_id INTEGER
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE notifications.delivery_jobs
    SET state = 'queued'
    WHERE id = p_id AND state = 'processing';
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_release(INTEGER);
