-- LINT-IGNORE: additive-only
-- LINT-IGNORE: idempotency
-- v1 -> v2 fingerprint cutover. Prep: 6523/6524/6536.

--------------UP

-- 1. Canonical compute helper. Field-scoped kinds carry :component.field;
-- per-fire incidents carry :t:<ms>; composite carries :composite; every
-- subject-level kind has no discriminator. p_anchor_ms is milliseconds.
DROP FUNCTION IF EXISTS notifications.fn_compute_fingerprint_v2(
    BIGINT, VARCHAR, VARCHAR, VARCHAR, JSONB, BIGINT
);
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
        WHEN 'entity_threshold' THEN
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

-- 2. Pre-resolve any open-state rows that would collide on the corrected v2
-- (keep the newest). Expected to be a no-op — the v1 unique index already
-- enforced one open row per logical key — but guards the backfill below from
-- a unique-violation that would abort the migration.
WITH computed AS (
    SELECT
        ai.id,
        ai.rule_id,
        ai.active_since,
        notifications.fn_compute_fingerprint_v2(
            ai.rule_id, ai.rule_kind, ai.source_subject_type,
            ai.source_subject_id, ai.context,
            (EXTRACT(EPOCH FROM ai.active_since) * 1000)::BIGINT
        ) AS v2
    FROM notifications.alert_instances ai
    WHERE ai.state IN ('active', 'acknowledged', 'cleared_unack', 'cleared_ack')
),
ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY rule_id, v2 ORDER BY active_since DESC, id DESC
        ) AS rn
    FROM computed
)
UPDATE notifications.alert_instances ai
SET state = 'resolved', resolved_at = NOW()
FROM ranked
WHERE ai.id = ranked.id AND ranked.rn > 1;

-- 3. Re-backfill every row with the corrected helper.
UPDATE notifications.alert_instances ai
SET fingerprint_v2 = notifications.fn_compute_fingerprint_v2(
    ai.rule_id, ai.rule_kind, ai.source_subject_type, ai.source_subject_id,
    ai.context,
    (EXTRACT(EPOCH FROM ai.active_since) * 1000)::BIGINT
);

-- 4. Drop the unused ops helper that referenced the old column name.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_v2_integrity();

-- 5. Drop the legacy v1 unique index, then the v1 column. v2 becomes the one
-- canonical `fingerprint`; its indexes follow the rename.
DROP INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_active;
ALTER TABLE notifications.alert_instances DROP COLUMN fingerprint;
ALTER TABLE notifications.alert_instances
    RENAME COLUMN fingerprint_v2 TO fingerprint;
ALTER INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_v2_active
    RENAME TO alert_instances_rule_fingerprint_active;
ALTER INDEX IF EXISTS notifications.alert_instances_fingerprint_v2_idx
    RENAME TO alert_instances_fingerprint_idx;

-- 6. Upsert now matches/writes the single canonical column. Explicit column
-- lists (no ai.*) so it is independent of physical column order.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_upsert(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT,
    VARCHAR, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_upsert(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_severity                  VARCHAR,
    p_subject_type              VARCHAR,
    p_subject_id                VARCHAR,
    p_title                     VARCHAR,
    p_message                   TEXT,
    p_context                   JSONB   DEFAULT '{}'::jsonb,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_dedupe_window_sec         INTEGER DEFAULT 0,
    p_fingerprint_v2            VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                           INTEGER,
    organization_id              VARCHAR,
    rule_id                      INTEGER,
    rule_kind                    VARCHAR,
    state                        VARCHAR,
    severity                     VARCHAR,
    source_subject_type          VARCHAR,
    source_subject_id            VARCHAR,
    title                        VARCHAR,
    message                      TEXT,
    fingerprint                  VARCHAR,
    active_since                 TIMESTAMPTZ,
    last_triggered_at            TIMESTAMPTZ,
    last_notified_at             TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB,
    was_created                  BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_effective_severity VARCHAR;
    v_window INTERVAL := COALESCE(p_dedupe_window_sec, 0) * INTERVAL '1 second';
    v_was_resolved BOOLEAN;
    v_created BOOLEAN := FALSE;
BEGIN
    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT ai.id, ai.resolved_at IS NOT NULL
    INTO v_id, v_was_resolved
    FROM notifications.alert_instances ai
    WHERE ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint_v2
      AND (
          ai.resolved_at IS NULL
          OR (v_window > INTERVAL '0' AND ai.resolved_at > NOW() - v_window)
      )
    ORDER BY ai.resolved_at NULLS FIRST
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE notifications.alert_instances ai
        SET state             = CASE WHEN v_was_resolved THEN 'active'
                                     ELSE ai.state END,
            resolved_at       = CASE WHEN v_was_resolved THEN NULL
                                     ELSE ai.resolved_at END,
            last_triggered_at = NOW(),
            context           = p_context,
            severity          = v_effective_severity,
            title             = p_title,
            message           = p_message
        WHERE ai.id = v_id;

        PERFORM notifications.fn_alert_transition_append(
            v_id, 'triggered', NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
    ELSE
        INSERT INTO notifications.alert_instances (
            organization_id, rule_id, rule_kind, state, severity,
            source_subject_type, source_subject_id,
            title, message, fingerprint, context
        )
        VALUES (
            p_organization_id, p_rule_id, p_rule_kind, 'active',
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, p_context
        )
        RETURNING alert_instances.id INTO v_id;
        v_created := TRUE;
    END IF;

    RETURN QUERY
    SELECT
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.last_notified_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context, v_created AS was_created
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

-- 7. Auto-resolve matches the canonical column. Param renamed -> p_fingerprint_v2.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_auto_resolve(
    VARCHAR, INTEGER, VARCHAR
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint_v2  VARCHAR
)
RETURNS TABLE (
    id                           INTEGER,
    organization_id              VARCHAR,
    rule_id                      INTEGER,
    rule_kind                    VARCHAR,
    state                        VARCHAR,
    severity                     VARCHAR,
    source_subject_type          VARCHAR,
    source_subject_id            VARCHAR,
    title                        VARCHAR,
    message                      TEXT,
    fingerprint                  VARCHAR,
    active_since                 TIMESTAMPTZ,
    last_triggered_at            TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB
)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE notifications.alert_instances ai
        SET state = CASE
                WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                    THEN 'cleared_unack'
                ELSE 'resolved'
            END,
            resolved_at = CASE
                WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                    THEN ai.resolved_at
                ELSE NOW()
            END
        WHERE ai.organization_id = p_organization_id
          AND ai.rule_id = p_rule_id
          AND ai.fingerprint = p_fingerprint_v2
          AND ai.resolved_at IS NULL
        RETURNING
            ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
            ai.severity, ai.source_subject_type, ai.source_subject_id,
            ai.title, ai.message, ai.fingerprint, ai.active_since,
            ai.last_triggered_at, ai.acknowledged_at,
            ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
            ai.resolved_at, ai.silenced_until, ai.silence_reason,
            ai.notifications_created_count, ai.delivery_jobs_created_count,
            ai.context
    ),
    logged AS (
        INSERT INTO notifications.alert_transitions (alert_id, action, data)
        SELECT u.id, u.state, '{}'::jsonb FROM updated u
        RETURNING alert_id
    )
    SELECT u.id, u.organization_id, u.rule_id, u.rule_kind, u.state,
           u.severity, u.source_subject_type, u.source_subject_id,
           u.title, u.message, u.fingerprint, u.active_since,
           u.last_triggered_at, u.acknowledged_at,
           u.acknowledged_by_user_id, u.acknowledged_by_display_name,
           u.resolved_at, u.silenced_until, u.silence_reason,
           u.notifications_created_count, u.delivery_jobs_created_count,
           u.context
      FROM updated u
     WHERE (SELECT count(*) FROM logged) >= 0;
$$;

--------------DOWN
-- Lossy: the dropped v1 fingerprint values cannot be recovered. Re-adds the
-- column (populated from the v2 value) so the schema shape is restored.
ALTER INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_active
    RENAME TO alert_instances_rule_fingerprint_v2_active;
ALTER INDEX IF EXISTS notifications.alert_instances_fingerprint_idx
    RENAME TO alert_instances_fingerprint_v2_idx;
ALTER TABLE notifications.alert_instances
    RENAME COLUMN fingerprint TO fingerprint_v2;
ALTER TABLE notifications.alert_instances
    ADD COLUMN fingerprint VARCHAR(255);
UPDATE notifications.alert_instances SET fingerprint = fingerprint_v2;
ALTER TABLE notifications.alert_instances
    ALTER COLUMN fingerprint SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_rule_fingerprint_active_v1
    ON notifications.alert_instances (rule_id, fingerprint)
    WHERE resolved_at IS NULL;
