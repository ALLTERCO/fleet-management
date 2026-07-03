--------------UP
-- Per-group retention is now enforced by the leader-elected sweep, so demote
-- the blanket 90-day policy to a far-future ceiling (7y) that only backstops
-- unbounded growth — the old 90-day drop silently lost longer-kept history.
SET search_path TO logging, public;

-- delete_job first: add_retention_policy(if_not_exists) would otherwise no-op
-- against the existing 90-day job and never apply the ceiling.
SELECT delete_job(j.job_id)
FROM timescaledb_information.jobs j
WHERE j.hypertable_name = 'audit_log' AND j.proc_name = 'policy_retention';

SELECT add_retention_policy(
    'logging.audit_log',
    INTERVAL '2557 days',
    if_not_exists => TRUE
);

-- Fail loud if the ceiling policy did not register; silent no-op = no backstop.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
        WHERE hypertable_name = 'audit_log'
          AND proc_name = 'policy_retention'
    ) THEN
        RAISE EXCEPTION 'ceiling retention policy failed to register on logging.audit_log';
    END IF;
END $$;
--------------DOWN
-- Caveat: rolling back restores the 90-day blanket drop. Disable the
-- AuditRetentionScheduler too, or audit history is silently lost again at 90d.
SET search_path TO logging, public;

SELECT delete_job(j.job_id)
FROM timescaledb_information.jobs j
WHERE j.hypertable_name = 'audit_log' AND j.proc_name = 'policy_retention';

SELECT add_retention_policy(
    'logging.audit_log',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
        WHERE hypertable_name = 'audit_log'
          AND proc_name = 'policy_retention'
    ) THEN
        RAISE EXCEPTION 'retention policy failed to register on logging.audit_log';
    END IF;
END $$;
