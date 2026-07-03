--------------UP
-- Adds 'superseded' to delivery_jobs.state so the flush path can collapse
-- multiple queued jobs for the same (alert_id, endpoint_id) — one job per
-- state transition pre-grouping — into a single sent notification plus
-- "superseded" audit rows for the older ones.
ALTER TABLE notifications.delivery_jobs
    DROP CONSTRAINT IF EXISTS delivery_jobs_state_valid;
ALTER TABLE notifications.delivery_jobs
    ADD CONSTRAINT delivery_jobs_state_valid CHECK (state IN (
        'queued','processing','succeeded','failed','superseded'
    ));

-- Partial index for the flush path — fn_delivery_job_for_group looks up
-- queued jobs by (alert_id, endpoint_id). Existing indexes scan by org or
-- by endpoint+created_at, neither is selective here at 7k+ alerts.
CREATE INDEX IF NOT EXISTS delivery_jobs_queued_by_alert_endpoint
    ON notifications.delivery_jobs (alert_id, endpoint_id)
    WHERE state = 'queued';

--------------DOWN
DROP INDEX IF EXISTS notifications.delivery_jobs_queued_by_alert_endpoint;
ALTER TABLE notifications.delivery_jobs
    DROP CONSTRAINT IF EXISTS delivery_jobs_state_valid;
ALTER TABLE notifications.delivery_jobs
    ADD CONSTRAINT delivery_jobs_state_valid CHECK (state IN (
        'queued','processing','succeeded','failed'
    ));
