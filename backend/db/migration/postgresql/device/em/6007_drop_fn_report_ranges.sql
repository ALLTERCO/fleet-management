--------------UP
-- Phase 7 cleanup: drop the orphan `fn_report_ranges`.
--
-- Verified zero callers across `backend/src` and the rest of
-- `backend/db/migration`. The original function was an exploratory
-- per-device row-count + first/last-timestamp query against the
-- 24h continuous aggregate. Nothing in the live RPC surface or any
-- other DB function references it.
--
-- DOWN recreates the original definition verbatim for full
-- reversibility.
DROP FUNCTION IF EXISTS device_em.fn_report_ranges();
--------------DOWN
CREATE FUNCTION device_em.fn_report_ranges()
    RETURNS table (
        device VARCHAR (100),
        total_records BIGINT,
        firs_rec TIMESTAMP WITH TIME ZONE,
        last_rec TIMESTAMP WITH TIME ZONE
    )
AS
$$
BEGIN
    RETURN QUERY (
        SELECT
            s.device,
            COUNT(s.device) total_records,
            MIN(s.ts) firs_rec,
            MAX(s.ts) last_rec
        FROM device_em.mv__total_energy_24_h s
        GROUP BY
            s.device
    );
END;
$$
LANGUAGE plpgsql;
