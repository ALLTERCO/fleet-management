--------------UP
-- Keep SQL backfill fingerprints identical to the TS alert fingerprint builder.
-- 6572 handled the old entity_* names; public component_* names need the same
-- field discriminator after the rename.
CREATE OR REPLACE FUNCTION notifications.fn_compute_fingerprint_v2(
    p_rule_id       BIGINT,
    p_rule_kind     VARCHAR,
    p_subject_type  VARCHAR,
    p_subject_id    VARCHAR,
    p_context       JSONB,
    p_anchor_ms     BIGINT DEFAULT NULL
) RETURNS VARCHAR
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_base VARCHAR;
    v_ctx  JSONB := COALESCE(p_context, '{}'::jsonb);
    v_ts   VARCHAR := COALESCE(
        p_anchor_ms::TEXT,
        (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT::TEXT
    );
BEGIN
    v_base := 'rule:' || p_rule_id || ':' || p_subject_type || ':'
        || p_subject_id;
    RETURN v_base || CASE p_rule_kind
        WHEN 'component_threshold' THEN
            ':' || COALESCE(v_ctx->>'component', '')
                || '.' || COALESCE(v_ctx->>'field', '')
        WHEN 'component_state' THEN
            ':' || COALESCE(v_ctx->>'component', '')
                || '.' || COALESCE(v_ctx->>'field', '')
        WHEN 'entity_threshold' THEN
            ':' || COALESCE(v_ctx->>'component', '')
                || '.' || COALESCE(v_ctx->>'field', '')
        WHEN 'entity_state' THEN
            ':' || COALESCE(v_ctx->>'component', '')
                || '.' || COALESCE(v_ctx->>'field', '')
        WHEN 'anomaly_band' THEN
            ':' || COALESCE(v_ctx->>'component', '')
                || '.' || COALESCE(v_ctx->>'field', '')
        WHEN 'change_event' THEN
            ':' || COALESCE(v_ctx->>'component', '')
                || '.' || COALESCE(v_ctx->>'field', '')
        WHEN 'device_event' THEN
            ':' || COALESCE(v_ctx->>'componentKey', '')
                || '.' || COALESCE(v_ctx->>'event', '')
        WHEN 'composite' THEN ':composite'
        WHEN 'firmware_operation_failed' THEN ':t:' || v_ts
        WHEN 'backup_operation_failed'   THEN ':t:' || v_ts
        WHEN 'automation_run_failed'     THEN ':t:' || v_ts
        WHEN 'device_back_online'        THEN ':t:' || v_ts
        ELSE ''
    END;
END;
$$;

--------------DOWN
-- No-op: reverting would reintroduce SQL-vs-TS fingerprint drift.
