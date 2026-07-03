--------------UP
CREATE INDEX IF NOT EXISTS delivery_jobs_processing_reclaim
    ON notifications.delivery_jobs (processing_started_at)
    WHERE state = 'processing' AND processing_started_at IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS notifications.delivery_jobs_processing_reclaim;
