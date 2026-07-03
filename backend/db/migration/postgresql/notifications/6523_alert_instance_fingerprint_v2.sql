--------------UP
-- Step 1+2 of the fingerprint dual-shape migration. See
-- docs/plans/2026-05-29-alert-design-fingerprint-migration.md.
--
-- Adds the new column + computes it for existing rows. Does NOT add the
-- unique index yet, does NOT cut over the upsert's ON CONFLICT target.
-- Evaluators start writing both columns in the application layer; a
-- later migration (Phase 8) builds the v2 index CONCURRENTLY and drops
-- the legacy column.

ALTER TABLE notifications.alert_instances
    ADD COLUMN IF NOT EXISTS fingerprint_v2 VARCHAR(500);

CREATE INDEX IF NOT EXISTS alert_instances_fingerprint_v2_idx
    ON notifications.alert_instances (rule_id, fingerprint_v2)
    WHERE fingerprint_v2 IS NOT NULL;

-- Pure helper: rule_id, kind, subject, context → v2 fingerprint string.
-- Discriminator per family:
--   entity_threshold  -> :<component>.<field>:<threshold>
--   battery_below     -> :<channel> (defaults to 'battery')
--   firmware/backup/automation -> :t:<created_at_epoch> (per-fire identity)
--   everything else   -> no discriminator
CREATE OR REPLACE FUNCTION notifications.fn_compute_fingerprint_v2(
    p_rule_id       BIGINT,
    p_rule_kind     VARCHAR,
    p_subject_type  VARCHAR,
    p_subject_id    VARCHAR,
    p_context       JSONB,
    p_anchor_epoch  BIGINT DEFAULT NULL
) RETURNS VARCHAR
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_base VARCHAR;
    v_ctx  JSONB := COALESCE(p_context, '{}'::jsonb);
BEGIN
    v_base := 'rule:' || p_rule_id || ':' || p_subject_type || ':' || p_subject_id;
    RETURN v_base || CASE p_rule_kind
        WHEN 'entity_threshold' THEN
            ':' || COALESCE(v_ctx->>'component', '') ||
            '.' || COALESCE(v_ctx->>'field', '') ||
            ':' || COALESCE(v_ctx->>'threshold', '')
        WHEN 'battery_below' THEN
            ':' || COALESCE(v_ctx->>'channel', 'battery')
        WHEN 'firmware_operation_failed' THEN
            ':t:' || COALESCE(p_anchor_epoch::TEXT, EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)
        WHEN 'backup_operation_failed' THEN
            ':t:' || COALESCE(p_anchor_epoch::TEXT, EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)
        WHEN 'automation_run_failed' THEN
            ':t:' || COALESCE(p_anchor_epoch::TEXT, EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)
        ELSE
            ''
    END;
END;
$$;

-- Backfill existing rows. Time-stamped kinds use active_since so
-- multiple historical rows keep their identity instead of collapsing.
UPDATE notifications.alert_instances ai
SET fingerprint_v2 = notifications.fn_compute_fingerprint_v2(
    ai.rule_id, ai.rule_kind, ai.source_subject_type, ai.source_subject_id,
    ai.context,
    EXTRACT(EPOCH FROM ai.active_since)::BIGINT
)
WHERE ai.fingerprint_v2 IS NULL;

--------------DOWN
DROP INDEX IF EXISTS notifications.alert_instances_fingerprint_v2_idx;
DROP FUNCTION IF EXISTS notifications.fn_compute_fingerprint_v2(
    BIGINT, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT
);
ALTER TABLE notifications.alert_instances
    DROP COLUMN IF EXISTS fingerprint_v2;
