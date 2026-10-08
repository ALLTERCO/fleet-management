--------------UP
-- Where an alert happened is part of the alert, not a lookup the reader has to
-- redo. Resolve the subject's location once, when the instance row is created.
-- A device that later moves site must not rewrite the history of an alert that
-- fired at the old one — the same reason backups stamp their owner at capture.
--
-- Deliberately no foreign key: the stamp is a historical snapshot, so deleting
-- a location must neither be blocked by past alerts nor erase where they fired.
ALTER TABLE notifications.alert_instances
    ADD COLUMN IF NOT EXISTS source_location_id INTEGER;

-- One home for the rule. The insert trigger, the backfill below, and anything
-- added later all resolve through this function.
CREATE OR REPLACE FUNCTION notifications.fn_alert_source_location_id(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR,
    p_device_id       INTEGER,
    p_entity_suffix   VARCHAR
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    -- Most specific answer first. A group or a tag matches no arm and so
    -- reports none: it spans many locations, or none, and there is no single
    -- honest answer.
    SELECT COALESCE(
        -- The subject already is the location.
        CASE WHEN p_subject_type = 'location'
                  AND p_subject_id ~ '^[0-9]{1,9}$'
             THEN p_subject_id::INTEGER
        END,
        -- A component sits where its own assignment says, and otherwise where
        -- its device sits — the same precedence the Instance.List location
        -- filter already applies (see 7229).
        CASE WHEN p_subject_type = 'entity' THEN (
            SELECT la.location_id
              FROM organization.location_assignments la
             WHERE la.organization_id = p_organization_id
               AND la.subject_type = 'entity'
               AND (
                   (la.device_id = p_device_id
                    AND la.entity_suffix = p_entity_suffix)
                   OR la.subject_id = p_subject_id
               )
             LIMIT 1
        ) END,
        -- At most one direct assignment exists per device
        -- (organization.location_assignments unique key).
        CASE WHEN p_subject_type IN ('device', 'entity') THEN (
            SELECT la.location_id
              FROM organization.location_assignments la
             WHERE la.organization_id = p_organization_id
               AND la.subject_type = 'device'
               AND la.device_id = p_device_id
             LIMIT 1
        ) END
    );
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_location_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.source_location_id := notifications.fn_alert_source_location_id(
        NEW.organization_id,
        NEW.source_subject_type,
        NEW.source_subject_id,
        NEW.source_device_id,
        NEW.source_entity_suffix
    );
    RETURN NEW;
END;
$$;

-- INSERT only: the stamp is the location at creation time and must never be
-- rewritten. PostgreSQL fires same-event triggers in alphabetical name order,
-- so alert_instance_device_subject_set runs first and source_device_id /
-- source_entity_suffix are already normalized when this one reads them.
DROP TRIGGER IF EXISTS alert_instance_location_stamp
    ON notifications.alert_instances;
CREATE TRIGGER alert_instance_location_stamp
BEFORE INSERT ON notifications.alert_instances
FOR EACH ROW
EXECUTE FUNCTION notifications.fn_alert_instance_location_stamp();

-- One-time best effort for rows written before the column existed: where their
-- subject sits today. Their real creation-time location is unknowable.
UPDATE notifications.alert_instances a
   SET source_location_id = notifications.fn_alert_source_location_id(
           a.organization_id,
           a.source_subject_type,
           a.source_subject_id,
           a.source_device_id,
           a.source_entity_suffix
       )
 WHERE a.source_location_id IS NULL;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_get(VARCHAR, INTEGER);
CREATE FUNCTION notifications.fn_alert_instance_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    source_location_id            INTEGER,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE sql
AS $$
    SELECT
        ai.id,
        ai.organization_id,
        ai.rule_id,
        ai.rule_kind,
        ai.state,
        ai.severity,
        ai.source_subject_type,
        ai.source_subject_id,
        ai.source_location_id,
        ai.title,
        ai.message,
        ai.fingerprint,
        ai.active_since,
        ai.last_triggered_at,
        ai.acknowledged_at,
        ai.acknowledged_by_user_id,
        ai.acknowledged_by_display_name,
        ai.resolved_at,
        ai.silenced_until,
        ai.silence_reason,
        ai.notifications_created_count,
        ai.delivery_jobs_created_count,
        ai.context
    FROM notifications.alert_instances ai
    WHERE ai.organization_id = p_organization_id
      AND ai.id = p_id;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_apply_action(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TIMESTAMPTZ, TEXT, JSONB, VARCHAR
);
CREATE FUNCTION notifications.fn_alert_instance_apply_action(
    p_organization_id     VARCHAR,
    p_id                  INTEGER,
    p_action              VARCHAR,
    p_actor_user_id       VARCHAR DEFAULT NULL,
    p_actor_display_name  VARCHAR DEFAULT NULL,
    p_silenced_until      TIMESTAMPTZ DEFAULT NULL,
    p_silence_reason      TEXT DEFAULT NULL,
    p_transition_data     JSONB DEFAULT '{}'::jsonb,
    p_ack_comment         VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    source_location_id            INTEGER,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    ack_comment                   VARCHAR,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row notifications.alert_instances%ROWTYPE;
BEGIN
    CASE p_action
        WHEN 'acknowledged' THEN
            -- active → acknowledged; cleared_unack → cleared_ack.
            UPDATE notifications.alert_instances ai
            SET state = CASE
                    WHEN ai.state = 'cleared_unack' THEN 'cleared_ack'
                    ELSE 'acknowledged'
                END,
                acknowledged_at = NOW(),
                acknowledged_by_user_id = p_actor_user_id,
                acknowledged_by_display_name = p_actor_display_name,
                ack_comment = p_ack_comment
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.state IN ('active', 'cleared_unack')
            RETURNING ai.* INTO v_row;

        WHEN 'unacknowledged' THEN
            -- acknowledged → active; cleared_ack → cleared_unack.
            UPDATE notifications.alert_instances ai
            SET state = CASE
                    WHEN ai.state = 'cleared_ack' THEN 'cleared_unack'
                    ELSE 'active'
                END,
                acknowledged_at = NULL,
                acknowledged_by_user_id = NULL,
                acknowledged_by_display_name = NULL,
                ack_comment = NULL
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.state IN ('acknowledged', 'cleared_ack')
            RETURNING ai.* INTO v_row;

        WHEN 'silenced' THEN
            UPDATE notifications.alert_instances ai
            SET silenced_until = p_silenced_until,
                silence_reason = p_silence_reason
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
            RETURNING ai.* INTO v_row;

        WHEN 'unsilenced' THEN
            UPDATE notifications.alert_instances ai
            SET silenced_until = NULL,
                silence_reason = NULL
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
              AND (ai.silenced_until IS NOT NULL OR ai.silence_reason IS NOT NULL)
            RETURNING ai.* INTO v_row;

        WHEN 'resolved' THEN
            -- Terminal from any non-resolved state.
            UPDATE notifications.alert_instances ai
            SET state = 'resolved',
                resolved_at = NOW()
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
            RETURNING ai.* INTO v_row;

        ELSE
            RAISE EXCEPTION 'Unsupported alert action: %', p_action
                USING ERRCODE = '22023';
    END CASE;

    IF v_row.id IS NULL THEN
        RETURN;
    END IF;

    PERFORM notifications.fn_alert_transition_append(
        v_row.id,
        p_action,
        p_actor_user_id,
        p_actor_display_name,
        COALESCE(p_transition_data, '{}'::jsonb)
    );

    RETURN QUERY
    SELECT
        v_row.id,
        v_row.organization_id,
        v_row.rule_id,
        v_row.rule_kind,
        v_row.state,
        v_row.severity,
        v_row.source_subject_type,
        v_row.source_subject_id,
        v_row.source_location_id,
        v_row.title,
        v_row.message,
        v_row.fingerprint,
        v_row.active_since,
        v_row.last_triggered_at,
        v_row.acknowledged_at,
        v_row.acknowledged_by_user_id,
        v_row.acknowledged_by_display_name,
        v_row.ack_comment,
        v_row.resolved_at,
        v_row.silenced_until,
        v_row.silence_reason,
        v_row.notifications_created_count,
        v_row.delivery_jobs_created_count,
        v_row.context;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_list(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR, VARCHAR,
    INTEGER[], INTEGER[], INTEGER[], VARCHAR, INTEGER, INTEGER
);
CREATE FUNCTION notifications.fn_alert_instance_list(
    p_organization_id VARCHAR,
    p_state VARCHAR DEFAULT NULL,
    p_severity VARCHAR DEFAULT NULL,
    p_rule_id INTEGER DEFAULT NULL,
    p_source_type VARCHAR DEFAULT NULL,
    p_source_id VARCHAR DEFAULT NULL,
    p_location_ids INTEGER[] DEFAULT NULL,
    p_group_ids INTEGER[] DEFAULT NULL,
    p_tag_ids INTEGER[] DEFAULT NULL,
    p_query VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT, id INTEGER, organization_id VARCHAR, rule_id INTEGER,
    rule_kind VARCHAR, state VARCHAR, severity VARCHAR,
    source_subject_type VARCHAR, source_subject_id VARCHAR,
    source_location_id INTEGER, title VARCHAR,
    message TEXT, fingerprint VARCHAR, active_since TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
    acknowledged_by_user_id VARCHAR, acknowledged_by_display_name VARCHAR,
    resolved_at TIMESTAMPTZ, silenced_until TIMESTAMPTZ,
    silence_reason TEXT, notifications_created_count INTEGER,
    delivery_jobs_created_count INTEGER, context JSONB
)
LANGUAGE sql STABLE AS $$
    WITH candidates AS (
        SELECT ai.*, d.external_id AS current_external_id
          FROM notifications.alert_instances ai
          LEFT JOIN device.list d
            ON d.organization_id = ai.organization_id
           AND d.id = ai.source_device_id
         WHERE ai.organization_id = p_organization_id
           AND (p_state IS NULL OR ai.state = p_state)
           AND (p_severity IS NULL OR ai.severity = p_severity)
           AND (p_rule_id IS NULL OR ai.rule_id = p_rule_id)
           AND (p_source_type IS NULL OR ai.source_subject_type = p_source_type)
           AND (
               p_source_id IS NULL
               OR (ai.source_subject_type = 'device'
                   AND ai.source_device_id::TEXT = p_source_id)
               OR (ai.source_subject_type <> 'device'
                   AND ai.source_subject_id = p_source_id)
           )
           AND (
               p_query IS NULL
               OR ai.title ILIKE '%' || p_query || '%'
               OR ai.message ILIKE '%' || p_query || '%'
               OR ai.fingerprint ILIKE '%' || p_query || '%'
               OR ai.source_subject_id ILIKE '%' || p_query || '%'
               OR d.external_id ILIKE '%' || p_query || '%'
           )
           AND (
               p_location_ids IS NULL
               OR (ai.source_subject_type = 'location'
                   AND ai.source_subject_id = ANY(
                       ARRAY(SELECT id::TEXT FROM unnest(p_location_ids) id)
                   ))
               OR EXISTS (
                   SELECT 1 FROM organization.location_assignments la
                    WHERE la.organization_id = ai.organization_id
                      AND la.location_id = ANY(p_location_ids)
                      AND (
                          (ai.source_subject_type = 'device'
                           AND la.subject_type = 'device'
                           AND la.device_id = ai.source_device_id)
                          OR
                          (ai.source_subject_type = 'entity'
                           AND la.subject_type = 'entity'
                           AND (
                               la.subject_id = ai.source_subject_id
                               OR (la.device_id IS NOT NULL
                                   AND ai.source_subject_id =
                                       la.device_id::TEXT || '_' || la.entity_suffix)
                           ))
                          OR
                          (ai.source_subject_type = 'entity'
                           AND la.subject_type = 'device'
                           AND la.device_id::TEXT = split_part(
                               ai.source_subject_id, '_', 1
                           ))
                      )
               )
           )
           AND (
               p_group_ids IS NULL
               OR (ai.source_subject_type = 'group'
                   AND ai.source_subject_id = ANY(
                       ARRAY(SELECT id::TEXT FROM unnest(p_group_ids) id)
                   ))
               OR EXISTS (
                   SELECT 1 FROM organization.group_members gm
                    WHERE gm.organization_id = ai.organization_id
                      AND gm.group_id = ANY(p_group_ids)
                      AND (
                          (ai.source_subject_type = 'device'
                           AND gm.subject_type = 'device'
                           AND gm.device_id = ai.source_device_id)
                          OR
                          (ai.source_subject_type = 'entity'
                           AND gm.subject_type = 'entity'
                           AND (
                               gm.subject_id = ai.source_subject_id
                               OR (gm.device_id IS NOT NULL
                                   AND ai.source_subject_id =
                                       gm.device_id::TEXT || '_' || gm.entity_suffix)
                           ))
                          OR
                          (ai.source_subject_type = 'entity'
                           AND gm.subject_type = 'device'
                           AND gm.device_id::TEXT = split_part(
                               ai.source_subject_id, '_', 1
                           ))
                          OR
                          (ai.source_subject_type = 'location'
                           AND gm.subject_type = 'location'
                           AND gm.subject_id = ai.source_subject_id)
                      )
               )
           )
           AND (
               p_tag_ids IS NULL
               OR EXISTS (
                   SELECT 1 FROM organization.tag_assignments ta
                    WHERE ta.organization_id = ai.organization_id
                      AND ta.tag_id = ANY(p_tag_ids)
                      AND (
                          (ai.source_subject_type = 'device'
                           AND ta.subject_type = 'device'
                           AND ta.device_id = ai.source_device_id)
                          OR
                          (ai.source_subject_type = 'entity'
                           AND ta.subject_type = 'entity'
                           AND (
                               ta.subject_id = ai.source_subject_id
                               OR (ta.device_id IS NOT NULL
                                   AND ai.source_subject_id =
                                       ta.device_id::TEXT || '_' || ta.entity_suffix)
                           ))
                          OR
                          (ai.source_subject_type = 'entity'
                           AND ta.subject_type = 'device'
                           AND ta.device_id::TEXT = split_part(
                               ai.source_subject_id, '_', 1
                           ))
                          OR
                          (ai.source_subject_type NOT IN ('device', 'entity')
                           AND ta.subject_type = ai.source_subject_type
                           AND ta.subject_id = ai.source_subject_id)
                      )
               )
           )
    ),
    total AS (SELECT count(*) AS count FROM candidates)
    SELECT total.count, ai.id, ai.organization_id, ai.rule_id, ai.rule_kind,
           ai.state, ai.severity, ai.source_subject_type,
           CASE WHEN ai.source_subject_type = 'device'
                THEN ai.current_external_id
                ELSE ai.source_subject_id END,
           ai.source_location_id,
           ai.title, ai.message, ai.fingerprint, ai.active_since,
           ai.last_triggered_at, ai.acknowledged_at,
           ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
           ai.resolved_at, ai.silenced_until, ai.silence_reason,
           ai.notifications_created_count, ai.delivery_jobs_created_count,
           ai.context
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM candidates
           ORDER BY last_triggered_at DESC, id DESC
           LIMIT p_limit OFFSET p_offset
      ) ai ON TRUE;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_list(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR, VARCHAR,
    INTEGER[], INTEGER[], INTEGER[], VARCHAR, INTEGER, INTEGER
);
CREATE FUNCTION notifications.fn_alert_instance_list(
    p_organization_id VARCHAR,
    p_state VARCHAR DEFAULT NULL,
    p_severity VARCHAR DEFAULT NULL,
    p_rule_id INTEGER DEFAULT NULL,
    p_source_type VARCHAR DEFAULT NULL,
    p_source_id VARCHAR DEFAULT NULL,
    p_location_ids INTEGER[] DEFAULT NULL,
    p_group_ids INTEGER[] DEFAULT NULL,
    p_tag_ids INTEGER[] DEFAULT NULL,
    p_query VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT, id INTEGER, organization_id VARCHAR, rule_id INTEGER,
    rule_kind VARCHAR, state VARCHAR, severity VARCHAR,
    source_subject_type VARCHAR, source_subject_id VARCHAR, title VARCHAR,
    message TEXT, fingerprint VARCHAR, active_since TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
    acknowledged_by_user_id VARCHAR, acknowledged_by_display_name VARCHAR,
    resolved_at TIMESTAMPTZ, silenced_until TIMESTAMPTZ,
    silence_reason TEXT, notifications_created_count INTEGER,
    delivery_jobs_created_count INTEGER, context JSONB
)
LANGUAGE sql STABLE AS $$
    WITH candidates AS (
        SELECT ai.*, d.external_id AS current_external_id
          FROM notifications.alert_instances ai
          LEFT JOIN device.list d
            ON d.organization_id = ai.organization_id
           AND d.id = ai.source_device_id
         WHERE ai.organization_id = p_organization_id
           AND (p_state IS NULL OR ai.state = p_state)
           AND (p_severity IS NULL OR ai.severity = p_severity)
           AND (p_rule_id IS NULL OR ai.rule_id = p_rule_id)
           AND (p_source_type IS NULL OR ai.source_subject_type = p_source_type)
           AND (
               p_source_id IS NULL
               OR (ai.source_subject_type = 'device'
                   AND ai.source_device_id::TEXT = p_source_id)
               OR (ai.source_subject_type <> 'device'
                   AND ai.source_subject_id = p_source_id)
           )
           AND (
               p_query IS NULL
               OR ai.title ILIKE '%' || p_query || '%'
               OR ai.message ILIKE '%' || p_query || '%'
               OR ai.fingerprint ILIKE '%' || p_query || '%'
               OR ai.source_subject_id ILIKE '%' || p_query || '%'
               OR d.external_id ILIKE '%' || p_query || '%'
           )
           AND (
               p_location_ids IS NULL
               OR (ai.source_subject_type = 'location'
                   AND ai.source_subject_id = ANY(
                       ARRAY(SELECT id::TEXT FROM unnest(p_location_ids) id)
                   ))
               OR EXISTS (
                   SELECT 1 FROM organization.location_assignments la
                    WHERE la.organization_id = ai.organization_id
                      AND la.location_id = ANY(p_location_ids)
                      AND (
                          (ai.source_subject_type = 'device'
                           AND la.subject_type = 'device'
                           AND la.device_id = ai.source_device_id)
                          OR
                          (ai.source_subject_type = 'entity'
                           AND la.subject_type = 'entity'
                           AND (
                               la.subject_id = ai.source_subject_id
                               OR (la.device_id IS NOT NULL
                                   AND ai.source_subject_id =
                                       la.device_id::TEXT || '_' || la.entity_suffix)
                           ))
                          OR
                          (ai.source_subject_type = 'entity'
                           AND la.subject_type = 'device'
                           AND la.device_id::TEXT = split_part(
                               ai.source_subject_id, '_', 1
                           ))
                      )
               )
           )
           AND (
               p_group_ids IS NULL
               OR (ai.source_subject_type = 'group'
                   AND ai.source_subject_id = ANY(
                       ARRAY(SELECT id::TEXT FROM unnest(p_group_ids) id)
                   ))
               OR EXISTS (
                   SELECT 1 FROM organization.group_members gm
                    WHERE gm.organization_id = ai.organization_id
                      AND gm.group_id = ANY(p_group_ids)
                      AND (
                          (ai.source_subject_type = 'device'
                           AND gm.subject_type = 'device'
                           AND gm.device_id = ai.source_device_id)
                          OR
                          (ai.source_subject_type = 'entity'
                           AND gm.subject_type = 'entity'
                           AND (
                               gm.subject_id = ai.source_subject_id
                               OR (gm.device_id IS NOT NULL
                                   AND ai.source_subject_id =
                                       gm.device_id::TEXT || '_' || gm.entity_suffix)
                           ))
                          OR
                          (ai.source_subject_type = 'entity'
                           AND gm.subject_type = 'device'
                           AND gm.device_id::TEXT = split_part(
                               ai.source_subject_id, '_', 1
                           ))
                          OR
                          (ai.source_subject_type = 'location'
                           AND gm.subject_type = 'location'
                           AND gm.subject_id = ai.source_subject_id)
                      )
               )
           )
           AND (
               p_tag_ids IS NULL
               OR EXISTS (
                   SELECT 1 FROM organization.tag_assignments ta
                    WHERE ta.organization_id = ai.organization_id
                      AND ta.tag_id = ANY(p_tag_ids)
                      AND (
                          (ai.source_subject_type = 'device'
                           AND ta.subject_type = 'device'
                           AND ta.device_id = ai.source_device_id)
                          OR
                          (ai.source_subject_type = 'entity'
                           AND ta.subject_type = 'entity'
                           AND (
                               ta.subject_id = ai.source_subject_id
                               OR (ta.device_id IS NOT NULL
                                   AND ai.source_subject_id =
                                       ta.device_id::TEXT || '_' || ta.entity_suffix)
                           ))
                          OR
                          (ai.source_subject_type = 'entity'
                           AND ta.subject_type = 'device'
                           AND ta.device_id::TEXT = split_part(
                               ai.source_subject_id, '_', 1
                           ))
                          OR
                          (ai.source_subject_type NOT IN ('device', 'entity')
                           AND ta.subject_type = ai.source_subject_type
                           AND ta.subject_id = ai.source_subject_id)
                      )
               )
           )
    ),
    total AS (SELECT count(*) AS count FROM candidates)
    SELECT total.count, ai.id, ai.organization_id, ai.rule_id, ai.rule_kind,
           ai.state, ai.severity, ai.source_subject_type,
           CASE WHEN ai.source_subject_type = 'device'
                THEN ai.current_external_id
                ELSE ai.source_subject_id END,
           ai.title, ai.message, ai.fingerprint, ai.active_since,
           ai.last_triggered_at, ai.acknowledged_at,
           ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
           ai.resolved_at, ai.silenced_until, ai.silence_reason,
           ai.notifications_created_count, ai.delivery_jobs_created_count,
           ai.context
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM candidates
           ORDER BY last_triggered_at DESC, id DESC
           LIMIT p_limit OFFSET p_offset
      ) ai ON TRUE;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_apply_action(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TIMESTAMPTZ, TEXT, JSONB, VARCHAR
);
CREATE FUNCTION notifications.fn_alert_instance_apply_action(
    p_organization_id     VARCHAR,
    p_id                  INTEGER,
    p_action              VARCHAR,
    p_actor_user_id       VARCHAR DEFAULT NULL,
    p_actor_display_name  VARCHAR DEFAULT NULL,
    p_silenced_until      TIMESTAMPTZ DEFAULT NULL,
    p_silence_reason      TEXT DEFAULT NULL,
    p_transition_data     JSONB DEFAULT '{}'::jsonb,
    p_ack_comment         VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    ack_comment                   VARCHAR,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row notifications.alert_instances%ROWTYPE;
BEGIN
    CASE p_action
        WHEN 'acknowledged' THEN
            UPDATE notifications.alert_instances ai
            SET state = CASE
                    WHEN ai.state = 'cleared_unack' THEN 'cleared_ack'
                    ELSE 'acknowledged'
                END,
                acknowledged_at = NOW(),
                acknowledged_by_user_id = p_actor_user_id,
                acknowledged_by_display_name = p_actor_display_name,
                ack_comment = p_ack_comment
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.state IN ('active', 'cleared_unack')
            RETURNING ai.* INTO v_row;

        WHEN 'unacknowledged' THEN
            UPDATE notifications.alert_instances ai
            SET state = CASE
                    WHEN ai.state = 'cleared_ack' THEN 'cleared_unack'
                    ELSE 'active'
                END,
                acknowledged_at = NULL,
                acknowledged_by_user_id = NULL,
                acknowledged_by_display_name = NULL,
                ack_comment = NULL
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.state IN ('acknowledged', 'cleared_ack')
            RETURNING ai.* INTO v_row;

        WHEN 'silenced' THEN
            UPDATE notifications.alert_instances ai
            SET silenced_until = p_silenced_until,
                silence_reason = p_silence_reason
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
            RETURNING ai.* INTO v_row;

        WHEN 'unsilenced' THEN
            UPDATE notifications.alert_instances ai
            SET silenced_until = NULL,
                silence_reason = NULL
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
              AND (ai.silenced_until IS NOT NULL OR ai.silence_reason IS NOT NULL)
            RETURNING ai.* INTO v_row;

        WHEN 'resolved' THEN
            UPDATE notifications.alert_instances ai
            SET state = 'resolved',
                resolved_at = NOW()
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
            RETURNING ai.* INTO v_row;

        ELSE
            RAISE EXCEPTION 'Unsupported alert action: %', p_action
                USING ERRCODE = '22023';
    END CASE;

    IF v_row.id IS NULL THEN
        RETURN;
    END IF;

    PERFORM notifications.fn_alert_transition_append(
        v_row.id,
        p_action,
        p_actor_user_id,
        p_actor_display_name,
        COALESCE(p_transition_data, '{}'::jsonb)
    );

    RETURN QUERY
    SELECT
        v_row.id,
        v_row.organization_id,
        v_row.rule_id,
        v_row.rule_kind,
        v_row.state,
        v_row.severity,
        v_row.source_subject_type,
        v_row.source_subject_id,
        v_row.title,
        v_row.message,
        v_row.fingerprint,
        v_row.active_since,
        v_row.last_triggered_at,
        v_row.acknowledged_at,
        v_row.acknowledged_by_user_id,
        v_row.acknowledged_by_display_name,
        v_row.ack_comment,
        v_row.resolved_at,
        v_row.silenced_until,
        v_row.silence_reason,
        v_row.notifications_created_count,
        v_row.delivery_jobs_created_count,
        v_row.context;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_get(VARCHAR, INTEGER);
CREATE FUNCTION notifications.fn_alert_instance_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE sql
AS $$
    SELECT
        ai.id,
        ai.organization_id,
        ai.rule_id,
        ai.rule_kind,
        ai.state,
        ai.severity,
        ai.source_subject_type,
        ai.source_subject_id,
        ai.title,
        ai.message,
        ai.fingerprint,
        ai.active_since,
        ai.last_triggered_at,
        ai.acknowledged_at,
        ai.acknowledged_by_user_id,
        ai.acknowledged_by_display_name,
        ai.resolved_at,
        ai.silenced_until,
        ai.silence_reason,
        ai.notifications_created_count,
        ai.delivery_jobs_created_count,
        ai.context
    FROM notifications.alert_instances ai
    WHERE ai.organization_id = p_organization_id
      AND ai.id = p_id;
$$;

DROP TRIGGER IF EXISTS alert_instance_location_stamp
    ON notifications.alert_instances;
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_location_stamp();
DROP FUNCTION IF EXISTS notifications.fn_alert_source_location_id(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR
);
ALTER TABLE notifications.alert_instances
    DROP COLUMN IF EXISTS source_location_id;
