--------------UP
-- Change reclaim semantics: stranded 'processing' rows are moved to
-- 'failed' (outcome unknown) instead of back to 'queued'.
--
-- The original DeliveryPayload lives only in graphile_worker.jobs; once
-- that row is gone, returning the delivery_jobs row to 'queued' creates
-- an orphan no scanner can re-enqueue. Worse, if the adapter had already
-- delivered before crashing, re-queueing risks a double-send.
--
-- Mark-as-failed semantics: the row is visible in the UI / audit trail,
-- with the explanatory error message. An operator can manually re-trigger
-- delivery via the alert/inbox UI if the outcome is in doubt.

SET search_path TO notifications;

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
           SET state = 'failed',
               completed_at = NOW(),
               processing_started_at = NULL
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

-- Restore prior 'queued' behaviour.
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
