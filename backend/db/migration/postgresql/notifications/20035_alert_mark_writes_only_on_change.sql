-- 97% of the writes to alert_instances change nothing.
--
-- MEASURED: fn_alert_instance_mark_evaluation_state runs about 508 times a
-- minute. RuleSweep.ts:787 accounts for 95% of them, marking 'no_data' for
-- devices whose last_seen is NULL, every 30 second tick, forever. Reported
-- 103,665 updates against 9,565 live rows, 97.1% of them no-ops. Each one wrote a
-- new tuple version, rewrote the JSONB context, and emitted a full-tuple WAL
-- image to store values identical to the ones already there.
--
-- THE WRITE IS NOW CONDITIONAL, AND THE READ TAKES A LOCK.
--
-- The lock is not incidental, it is what makes the condition correct. A plain
-- read plus a conditional write cannot tell "the row was resolved under us" from
-- "nothing changed": both surface as no rows updated. Getting that wrong invents
-- a duplicate open instance in one direction and silently drops the mark in the
-- other. FOR NO KEY UPDATE makes auto_resolve on this row wait rather than race,
-- so the comparison and the write see one snapshot. NO KEY, not UPDATE, because
-- the key columns are untouched and foreign keys should not block.
--
-- LIMIT 1 is gone from all three reads. The partial UNIQUE index from 20032
-- already guarantees at most one open row per (rule_id, fingerprint), and
-- FOR UPDATE combined with LIMIT is a known way to lock the wrong row.
--
-- TWO GATES, deliberately not one:
--   v_material    the four columns as before. Still gates the history append and
--                 the returned `changed` flag, so AlertEngine's WS emit is
--                 unchanged.
--   v_row_differs v_material plus context, which is the fifth column the UPDATE
--                 writes. A context-only drift must still land in the row, but
--                 must NOT write history. alert_transitions has no retention.
--
-- last_triggered_at is no longer bumped here. A no_data mark is not a fire.
-- 20033 moved the only reader, last_fired_at, onto alert_transitions where a
-- fire is actually recorded. Deploy 20033 first.
--
-- Round trips do not change. 508 calls a minute stays 508. What goes away is the
-- tuple churn, the JSONB rewrite and the WAL. Measure n_tup_upd, n_dead_tup and
-- a pg_current_wal_lsn() delta across identical windows, not the call count.
--------------UP
SET search_path TO notifications, public;

-- These signatures change their return type. CREATE OR REPLACE cannot do that:
-- PostgreSQL raises 42P13 and the whole migration fails, so the backend never
-- boots. Dropping first is safe because the UP block runs as one transaction.
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_mark_evaluation_state(VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_mark_evaluation_state(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_state                     VARCHAR,
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
    was_created                  BOOLEAN,
    changed                      BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_created BOOLEAN := FALSE;
    v_effective_severity VARCHAR;
    v_prev_state VARCHAR;
    v_prev_severity VARCHAR;
    v_prev_title VARCHAR;
    v_prev_message TEXT;
    v_prev_context JSONB;
    v_material BOOLEAN;
    v_row_differs BOOLEAN;
BEGIN
    IF p_state NOT IN ('pending','recovering','no_data','evaluation_error') THEN
        RAISE EXCEPTION 'Unsupported alert evaluation state: %', p_state
            USING ERRCODE = '22023';
    END IF;

    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    -- Locking read. The lock is what makes the conditional write below correct:
    -- without it, NOT FOUND cannot be told apart from "nothing changed", and the
    -- function either invents a duplicate instance or silently drops the mark.
    -- fn_apply_group_severity_floor already ran, so its joins stay outside the lock.
    SELECT ai.id, ai.state, ai.severity, ai.title, ai.message, ai.context
      INTO v_id, v_prev_state, v_prev_severity, v_prev_title, v_prev_message,
           v_prev_context
      FROM notifications.alert_instances ai
     WHERE ai.rule_id = p_rule_id
       AND ai.fingerprint = p_fingerprint_v2
       AND ai.resolved_at IS NULL
       FOR NO KEY UPDATE;

    IF v_id IS NULL THEN
        v_id := notifications.fn_alert_instance_insert_live(
            p_organization_id, p_rule_id, p_rule_kind, p_state,
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, p_context
        );

        IF v_id IS NOT NULL THEN
            v_created := TRUE;
        ELSE
            -- Lost the insert race: adopt the winner's live row.
            SELECT ai.id, ai.state, ai.severity, ai.title, ai.message,
                   ai.context
              INTO v_id, v_prev_state, v_prev_severity,
                   v_prev_title, v_prev_message, v_prev_context
              FROM notifications.alert_instances ai
             WHERE ai.rule_id = p_rule_id
               AND ai.fingerprint = p_fingerprint_v2
               AND ai.resolved_at IS NULL
               FOR NO KEY UPDATE;
        END IF;
    END IF;

    -- Material change: first mark, state transition, or content drift.
    v_material := v_created
        OR p_state IS DISTINCT FROM v_prev_state
        OR v_effective_severity IS DISTINCT FROM v_prev_severity
        OR p_title IS DISTINCT FROM v_prev_title
        OR p_message IS DISTINCT FROM v_prev_message;

    -- The five columns the UPDATE writes. context is JSONB, so IS DISTINCT FROM
    -- compares by value: reordered keys, and 4.40 versus 4.4, are not differences.
    v_row_differs := v_material
        OR COALESCE(p_context, '{}'::jsonb) IS DISTINCT FROM v_prev_context;

    IF v_id IS NOT NULL AND NOT v_created AND v_row_differs THEN
        -- The predicate is re-asserted on the WRITE, not only on the read above.
        -- auto_resolve can commit in between; updating by id alone wrote
        -- state='pending' onto a row it had just resolved, leaving resolved_at set on
        -- a non-resolved row. That row was invisible to auto_resolve for good while
        -- still holding the unique (rule_id, fingerprint) slot, so no new alert could
        -- ever fire for that subject. Measured: 15 such rows.
        UPDATE notifications.alert_instances ai
           SET state = p_state,
               severity = v_effective_severity,
               title = p_title,
               message = p_message,
               context = COALESCE(p_context, '{}'::jsonb)
         WHERE ai.id = v_id
           AND ai.resolved_at IS NULL;
        IF NOT FOUND THEN
            -- Resolved under us. A fresh live instance is the correct outcome; this
            -- is the same insert-then-adopt path used above.
            v_id := notifications.fn_alert_instance_insert_live(
                p_organization_id, p_rule_id, p_rule_kind, p_state,
                v_effective_severity, p_subject_type, p_subject_id,
                p_title, p_message, p_fingerprint_v2, p_context
            );
            IF v_id IS NOT NULL THEN
                v_created := TRUE;
                v_material := TRUE;
            ELSE
                SELECT ai.id, ai.state, ai.severity, ai.title, ai.message,
                       ai.context
                  INTO v_id, v_prev_state, v_prev_severity, v_prev_title,
                       v_prev_message, v_prev_context
                  FROM notifications.alert_instances ai
                 WHERE ai.rule_id = p_rule_id
                   AND ai.fingerprint = p_fingerprint_v2
                   AND ai.resolved_at IS NULL
                   FOR NO KEY UPDATE;
            END IF;
        END IF;
    END IF;

    -- History records material changes only (creation counts as changed).
    IF v_id IS NOT NULL AND v_material THEN
        PERFORM notifications.fn_alert_transition_append(
            v_id, p_state, NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
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
        ai.context, v_created AS was_created,
        COALESCE(v_material, TRUE) AS changed
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_mark_evaluation_state(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_rule_kind                 VARCHAR,
    p_state                     VARCHAR,
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
    was_created                  BOOLEAN,
    changed                      BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_created BOOLEAN := FALSE;
    v_effective_severity VARCHAR;
    v_prev_state VARCHAR;
    v_prev_severity VARCHAR;
    v_prev_title VARCHAR;
    v_prev_message TEXT;
    v_changed BOOLEAN;
BEGIN
    IF p_state NOT IN ('pending','recovering','no_data','evaluation_error') THEN
        RAISE EXCEPTION 'Unsupported alert evaluation state: %', p_state
            USING ERRCODE = '22023';
    END IF;

    v_effective_severity := notifications.fn_apply_group_severity_floor(
        p_organization_id, p_subject_type, p_subject_id, p_severity,
        p_default_floor_standard, p_default_floor_operational,
        p_default_floor_critical, p_default_floor_custom
    );

    SELECT ai.id, ai.state, ai.severity, ai.title, ai.message
      INTO v_id, v_prev_state, v_prev_severity, v_prev_title, v_prev_message
      FROM notifications.alert_instances ai
     WHERE ai.rule_id = p_rule_id
       AND ai.fingerprint = p_fingerprint_v2
       AND ai.resolved_at IS NULL
     LIMIT 1;

    IF v_id IS NULL THEN
        v_id := notifications.fn_alert_instance_insert_live(
            p_organization_id, p_rule_id, p_rule_kind, p_state,
            v_effective_severity, p_subject_type, p_subject_id,
            p_title, p_message, p_fingerprint_v2, p_context
        );

        IF v_id IS NOT NULL THEN
            v_created := TRUE;
        ELSE
            -- Lost the insert race: adopt the winner's live row.
            SELECT ai.id, ai.state, ai.severity, ai.title, ai.message
              INTO v_id, v_prev_state, v_prev_severity,
                   v_prev_title, v_prev_message
              FROM notifications.alert_instances ai
             WHERE ai.rule_id = p_rule_id
               AND ai.fingerprint = p_fingerprint_v2
               AND ai.resolved_at IS NULL
             LIMIT 1;
        END IF;
    END IF;

    -- Material change: first mark, state transition, or content drift.
    v_changed := v_created
        OR p_state IS DISTINCT FROM v_prev_state
        OR v_effective_severity IS DISTINCT FROM v_prev_severity
        OR p_title IS DISTINCT FROM v_prev_title
        OR p_message IS DISTINCT FROM v_prev_message;

    IF v_id IS NOT NULL AND NOT v_created THEN
        -- The predicate is re-asserted on the WRITE, not only on the read above.
        -- auto_resolve can commit in between; updating by id alone wrote
        -- state='pending' onto a row it had just resolved, leaving resolved_at set on
        -- a non-resolved row. That row was invisible to auto_resolve for good while
        -- still holding the unique (rule_id, fingerprint) slot, so no new alert could
        -- ever fire for that subject. Measured: 15 such rows.
        UPDATE notifications.alert_instances ai
           SET state = p_state,
               severity = v_effective_severity,
               title = p_title,
               message = p_message,
               context = COALESCE(p_context, '{}'::jsonb),
               last_triggered_at = NOW()
         WHERE ai.id = v_id
           AND ai.resolved_at IS NULL;
        IF NOT FOUND THEN
            -- Resolved under us. A fresh live instance is the correct outcome; this
            -- is the same insert-then-adopt path used above.
            v_id := notifications.fn_alert_instance_insert_live(
                p_organization_id, p_rule_id, p_rule_kind, p_state,
                v_effective_severity, p_subject_type, p_subject_id,
                p_title, p_message, p_fingerprint_v2, p_context
            );
            IF v_id IS NOT NULL THEN
                v_created := TRUE;
                v_changed := TRUE;
            ELSE
                SELECT ai.id
                  INTO v_id
                  FROM notifications.alert_instances ai
                 WHERE ai.rule_id = p_rule_id
                   AND ai.fingerprint = p_fingerprint_v2
                   AND ai.resolved_at IS NULL
                 LIMIT 1;
            END IF;
        END IF;
    END IF;

    -- History records material changes only (creation counts as changed).
    IF v_id IS NOT NULL AND v_changed THEN
        PERFORM notifications.fn_alert_transition_append(
            v_id, p_state, NULL, NULL, COALESCE(p_context, '{}'::jsonb)
        );
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
        ai.context, v_created AS was_created,
        COALESCE(v_changed, TRUE) AS changed
    FROM notifications.alert_instances ai
    WHERE ai.id = v_id;
END;
$$;
