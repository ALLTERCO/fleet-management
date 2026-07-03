--------------UP
-- Track when delivery_jobs transition to 'processing' so a crash-recovery
-- sweep can return stranded rows to 'queued' for retry by graphile-worker.

SET search_path TO notifications;

ALTER TABLE delivery_jobs
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Reclaim rows stuck in 'processing' longer than p_stale_ms back to
-- 'queued' so they get re-scheduled. Returns the count reclaimed.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_reclaim_stranded(
    p_stale_ms INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    n INTEGER;
BEGIN
    WITH reclaimed AS (
        UPDATE notifications.delivery_jobs
           SET state = 'queued', processing_started_at = NULL
         WHERE state = 'processing'
           AND processing_started_at IS NOT NULL
           AND processing_started_at < NOW() - (p_stale_ms || ' ms')::INTERVAL
        RETURNING id
    )
    SELECT COUNT(*)::INTEGER INTO n FROM reclaimed;
    RETURN n;
END;
$$;

--------------DOWN
SET search_path TO notifications;

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_reclaim_stranded(INTEGER);
ALTER TABLE delivery_jobs
    DROP COLUMN IF EXISTS processing_started_at;
