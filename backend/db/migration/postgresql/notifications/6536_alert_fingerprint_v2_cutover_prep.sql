-- Phase 8: prepare cutover from legacy `fingerprint` to `fingerprint_v2`.
--
-- This is the *prep* step, not the cutover:
--   1. Backfill completeness check  — fails the migration if any active
--      alert instance still has NULL fingerprint_v2 (would have meant the
--      6523 backfill missed a row or a race left one behind).
--   2. NOT NULL on fingerprint_v2   — enforced now that backfill is done.
--   3. UNIQUE partial index on (rule_id, fingerprint_v2) over
--      the open lifecycle states — mirrors the legacy index shape
--      so the ON CONFLICT cutover (separate migration once telemetry
--      shows zero collisions on the new key) becomes a one-line change.
--   4. Ops helper fn_alert_instance_v2_integrity() — returns the count
--      of rows with NULL fingerprint_v2 + active state so the runbook
--      check has a single SQL call.
--
-- The legacy `fingerprint` column + index are intentionally left in
-- place. Dropping them happens in a later phase, behind a deprecation
-- window and explicit human sign-off.

--------------UP

DO $$
DECLARE
    v_missing BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_missing
      FROM notifications.alert_instances
     WHERE fingerprint_v2 IS NULL;
    IF v_missing > 0 THEN
        RAISE EXCEPTION 'alert_instances has % rows with NULL fingerprint_v2 — re-run 6523 backfill before applying 6536', v_missing;
    END IF;
END$$;

ALTER TABLE notifications.alert_instances
    ALTER COLUMN fingerprint_v2 SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_rule_fingerprint_v2_active
    ON notifications.alert_instances (rule_id, fingerprint_v2)
    WHERE state IN ('active', 'acknowledged', 'cleared_unack', 'cleared_ack');

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_v2_integrity()
    RETURNS TABLE (
        active_total       BIGINT,
        v2_present         BIGINT,
        v2_missing_active  BIGINT
    )
    LANGUAGE plpgsql
    STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (
            WHERE state IN ('active', 'acknowledged', 'cleared_unack', 'cleared_ack')
        )::BIGINT                                     AS active_total,
        COUNT(*) FILTER (
            WHERE fingerprint_v2 IS NOT NULL
        )::BIGINT                                     AS v2_present,
        COUNT(*) FILTER (
            WHERE state IN ('active', 'acknowledged', 'cleared_unack', 'cleared_ack')
              AND fingerprint_v2 IS NULL
        )::BIGINT                                     AS v2_missing_active
    FROM notifications.alert_instances;
END;
$$;

--------------DOWN

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_v2_integrity();
DROP INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_v2_active;
ALTER TABLE notifications.alert_instances
    ALTER COLUMN fingerprint_v2 DROP NOT NULL;
