-- Whole-install count of rejected meter blocks waiting for a decision, for
-- the system health check.
--------------UP

CREATE OR REPLACE FUNCTION device_em.fn_sync_rejected_open_count_all()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS
$$
    SELECT count(*)
    FROM device_em.sync_rejected r
    WHERE r.requeued_at IS NULL;
$$;

--------------DOWN

DROP FUNCTION IF EXISTS device_em.fn_sync_rejected_open_count_all();
