-- "Alert is open" was defined twice, and the two had already drifted apart.
--
--   the unique index + the upsert's ON CONFLICT   state IN (8 states)
--   auto_resolve + mark_evaluation_state          resolved_at IS NULL
--
-- Nothing kept them in step. MEASURED on the dev fleet: 15 rows had
-- resolved_at set with state = 'pending'. The index counted them open, so they
-- held the (rule_id, fingerprint) slot and no new alert could be created for
-- those subjects; auto_resolve could never clear them because it filters on
-- resolved_at. 15 rule-and-subject pairs were silently dead. All 15 were
-- component_state or component_threshold, the kinds that hold for forSec.
--
-- HOW THEY GOT THERE — a read-modify-write in mark_evaluation_state:
--
--   SELECT id INTO v_id ... WHERE resolved_at IS NULL;   -- read
--   UPDATE ... WHERE id = v_id;                          -- write, predicate not re-checked
--
-- auto_resolve commits in between, so the UPDATE writes state='pending' onto a
-- row it has just resolved and leaves resolved_at set.
--
-- ONE definition from here: resolved_at IS NULL. It is a single column, so there
-- is no list to copy. The state list disappears from the index and from the
-- ON CONFLICT, and a CHECK makes divergence impossible rather than unlikely.
--
-- A plain (rule_id, fingerprint) WHERE resolved_at IS NULL index was added and then
-- withdrawn before commit. The DROP below stays: a dev database that ran the
-- withdrawn migration still has the index, and the unique index here covers the
-- same lookup.
--------------UP
SET search_path TO notifications, public;

-- 1. Repair. resolved_at is when auto_resolve ran; the state was overwritten
--    afterwards by the race. The timestamp is the truth, so the state follows it.
UPDATE notifications.alert_instances
   SET state = 'resolved'
 WHERE resolved_at IS NOT NULL
   AND state <> 'resolved';

--    The mirror direction. The index being replaced excluded 'resolved', so a
--    row with state 'resolved' and no resolved_at was constrained by nothing and
--    could always exist. The new index counts it open and the CHECK rejects it
--    outright, so leaving it would fail this migration mid-deploy and stop the
--    backend booting. There is no timestamp to trust here, so the state is.
UPDATE notifications.alert_instances
   SET resolved_at = NOW()
 WHERE state = 'resolved'
   AND resolved_at IS NULL;

-- 2. One predicate for "open", on the unique index that enforces the rule
--    "at most one open instance per rule and fingerprint".
DROP INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_active;
CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_rule_fingerprint_open
    ON notifications.alert_instances (rule_id, fingerprint)
    WHERE resolved_at IS NULL;

-- 3. Defensive: same columns and predicate as the index above, so it is redundant
--    wherever the withdrawn migration happened to run.
DROP INDEX IF EXISTS notifications.alert_instances_unresolved_lookup_idx;

-- 4. The invariant, so the two can never drift again. Every writer already sets
--    state and resolved_at together; only the race broke it.
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_resolved_at_matches_state;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_resolved_at_matches_state
    CHECK ((state = 'resolved') = (resolved_at IS NOT NULL));

-- 5. Both functions, rebuilt from their newest live definitions
--    (6935_alert_instance_upsert_race_safe.sql and 7313_alert_transition_coalesce.sql) with ONE predicate.
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_insert_live(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_rule_kind       VARCHAR,
    p_state           VARCHAR,
    p_severity        VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_title           VARCHAR,
    p_message         TEXT,
    p_fingerprint     VARCHAR,
    p_context         JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    -- NULL result = lost the race to a concurrent live insert.
    INSERT INTO notifications.alert_instances (
        organization_id, rule_id, rule_kind, state, severity,
        source_subject_type, source_subject_id,
        title, message, fingerprint, context
    )
    VALUES (
        p_organization_id, p_rule_id, p_rule_kind, p_state,
        p_severity, p_subject_type, p_subject_id,
        p_title, p_message, p_fingerprint, COALESCE(p_context, '{}'::jsonb)
    )
    ON CONFLICT (rule_id, fingerprint)
        WHERE resolved_at IS NULL
        DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

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

--------------DOWN
DROP INDEX IF EXISTS notifications.alert_instances_rule_fingerprint_open;
CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_rule_fingerprint_active
    ON notifications.alert_instances (rule_id, fingerprint)
    WHERE state IN (
        'pending',
        'active',
        'acknowledged',
        'recovering',
        'cleared_unack',
        'cleared_ack',
        'no_data',
        'evaluation_error'
    );
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_resolved_at_matches_state;

-- Restore the arbiter this function used before the UP. Postgres infers the
-- ON CONFLICT index by requiring its predicate to be implied by the clause
-- here; `resolved_at IS NULL` is not implied by the state list restored above,
-- so leaving the UP's body in place makes every insert raise 42P10 and takes
-- alerting down on a database the operator believes rolled back cleanly.
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_insert_live(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_rule_kind       VARCHAR,
    p_state           VARCHAR,
    p_severity        VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_title           VARCHAR,
    p_message         TEXT,
    p_fingerprint     VARCHAR,
    p_context         JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    -- NULL result = lost the race to a concurrent live insert.
    INSERT INTO notifications.alert_instances (
        organization_id, rule_id, rule_kind, state, severity,
        source_subject_type, source_subject_id,
        title, message, fingerprint, context
    )
    VALUES (
        p_organization_id, p_rule_id, p_rule_kind, p_state,
        p_severity, p_subject_type, p_subject_id,
        p_title, p_message, p_fingerprint, COALESCE(p_context, '{}'::jsonb)
    )
    ON CONFLICT (rule_id, fingerprint)
        WHERE state IN (
            'pending',
            'active',
            'acknowledged',
            'recovering',
            'cleared_unack',
            'cleared_ack',
            'no_data',
            'evaluation_error'
        )
        DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
