--------------UP
-- A caller scoped to a place, a group or a tag may only see the alerts about
-- what it reaches. That filter ran in TypeScript, after fn_alert_instance_list
-- and fn_alert_rule_list had already applied LIMIT/OFFSET, so a narrowed page
-- came back short and total_count counted rows the caller could not see.
--
-- Both functions now take the caller's reach and filter before slicing, so the
-- page is full and the total is true. A NULL p_reach_device_ids means the
-- caller is unrestricted and nothing is narrowed, which is the behaviour every
-- existing caller gets by not passing the argument.
--
-- The reach is four arrays, not one device list, because an alert may be about
-- a place or a group rather than a device, and a rule may name a location, a
-- group or a tag it has no device rows for.
--
-- Changing an argument list needs DROP + CREATE, not CREATE OR REPLACE.

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
    p_offset INTEGER DEFAULT 0,
    p_reach_device_ids VARCHAR[] DEFAULT NULL,
    p_reach_location_ids INTEGER[] DEFAULT NULL,
    p_reach_group_ids INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT, id INTEGER, organization_id VARCHAR, rule_id INTEGER,
    rule_kind VARCHAR, state VARCHAR, severity VARCHAR,
    source_subject_type VARCHAR, source_subject_id VARCHAR,
    source_location_id INTEGER, title VARCHAR,
    message TEXT, fingerprint VARCHAR, active_since TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
    acknowledged_by_user_id VARCHAR, acknowledged_by_display_name VARCHAR,
    ack_comment VARCHAR,
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
           AND (
               p_reach_device_ids IS NULL
               OR (ai.source_subject_type IN ('device', 'entity')
                   AND d.external_id = ANY(p_reach_device_ids))
               OR (ai.source_subject_type = 'location'
                   AND ai.source_subject_id = ANY(
                       ARRAY(SELECT id::TEXT FROM unnest(p_reach_location_ids) id)
                   ))
               OR (ai.source_subject_type = 'group'
                   AND ai.source_subject_id = ANY(
                       ARRAY(SELECT id::TEXT FROM unnest(p_reach_group_ids) id)
                   ))
               OR (ai.source_subject_type NOT IN ('device', 'entity', 'location', 'group')
                   AND ai.source_location_id = ANY(p_reach_location_ids))
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
           ai.ack_comment,
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

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list(
    p_organization_id VARCHAR,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_kind            VARCHAR DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_reach_device_ids   VARCHAR[] DEFAULT NULL,
    p_reach_location_ids INTEGER[] DEFAULT NULL,
    p_reach_group_ids    INTEGER[] DEFAULT NULL,
    p_reach_tag_ids      INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT, id INTEGER, organization_id VARCHAR, name VARCHAR,
    kind VARCHAR, enabled BOOLEAN, severity VARCHAR, scope JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    destination_group_ids INTEGER[], destination_channel_ids INTEGER[],
    owner_user_id VARCHAR, summary_template TEXT, message_template TEXT,
    auto_resolve BOOLEAN, config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    active_window JSONB,
    trigger_once BOOLEAN,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT * FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND r.deleted_at IS NULL
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
          AND (
              p_reach_device_ids IS NULL
              OR EXISTS (
                  SELECT 1
                    FROM notifications.alert_rule_device_scope ds
                    JOIN device.list d
                      ON d.organization_id = ds.organization_id
                     AND d.id = ds.device_id
                   WHERE ds.organization_id = r.organization_id
                     AND ds.rule_id = r.id
                     AND d.external_id = ANY(p_reach_device_ids)
              )
              OR EXISTS (
                  SELECT 1
                    FROM notifications.alert_rule_entity_scope es
                    LEFT JOIN device.list d
                      ON d.organization_id = es.organization_id
                     AND d.id = es.device_id
                   WHERE es.organization_id = r.organization_id
                     AND es.rule_id = r.id
                     AND COALESCE(
                             d.external_id,
                             split_part(es.virtual_entity_id, '_', 1)
                         ) = ANY(p_reach_device_ids)
              )
              OR EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(
                             COALESCE(r.scope->'locationIds', '[]'::jsonb)
                         ) v
                   WHERE v::INTEGER = ANY(p_reach_location_ids)
              )
              OR EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(
                             COALESCE(r.scope->'groupIds', '[]'::jsonb)
                         ) v
                   WHERE v::INTEGER = ANY(p_reach_group_ids)
              )
              OR EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(
                             COALESCE(r.scope->'tagIds', '[]'::jsonb)
                         ) v
                   WHERE v::INTEGER = ANY(p_reach_tag_ids)
              )
              -- An unscoped rule covers every device, so it covers the reach.
              OR (
                  cardinality(p_reach_device_ids) > 0
                  AND NOT EXISTS (
                      SELECT 1 FROM notifications.alert_rule_device_scope ds
                       WHERE ds.organization_id = r.organization_id
                         AND ds.rule_id = r.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM notifications.alert_rule_entity_scope es
                       WHERE es.organization_id = r.organization_id
                         AND es.rule_id = r.id
                  )
                  AND COALESCE(jsonb_array_length(r.scope->'locationIds'), 0) = 0
                  AND COALESCE(jsonb_array_length(r.scope->'groupIds'), 0) = 0
                  AND COALESCE(jsonb_array_length(r.scope->'tagIds'), 0) = 0
              )
          )
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT total.c, r.id, r.organization_id, r.name, r.kind, r.enabled,
        r.severity, r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        COALESCE(dest_ch.destination_channel_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by, r.delivery_mode,
        r.digest_window_minutes, r.runbook_url, r.template_id, r.active_window,
        r.trigger_once,
        lf.last_fired_at, r.created_at, r.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT * FROM filtered ORDER BY name ASC LIMIT p_limit OFFSET p_offset
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(c.channel_id ORDER BY c.channel_id ASC) AS destination_channel_ids
        FROM notifications.alert_rule_destination_channels c WHERE c.rule_id = r.id
    ) dest_ch ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(t.created_at) AS last_fired_at
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances ai ON ai.id = t.alert_id
        WHERE ai.rule_id = r.id
          AND t.action = 'triggered'
    ) lf ON TRUE;
$$;

--------------DOWN
-- Restores the argument lists this migration widened: fn_alert_instance_list
-- as 20040 left it and fn_alert_rule_list as 20043 left it.

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_list(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR, VARCHAR,
    INTEGER[], INTEGER[], INTEGER[], VARCHAR, INTEGER, INTEGER,
    VARCHAR[], INTEGER[], INTEGER[]
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(
    VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER,
    VARCHAR[], INTEGER[], INTEGER[], INTEGER[]
);

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
    ack_comment VARCHAR,
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
           ai.ack_comment,
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

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list(
    p_organization_id VARCHAR,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_kind            VARCHAR DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT, id INTEGER, organization_id VARCHAR, name VARCHAR,
    kind VARCHAR, enabled BOOLEAN, severity VARCHAR, scope JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    destination_group_ids INTEGER[], destination_channel_ids INTEGER[],
    owner_user_id VARCHAR, summary_template TEXT, message_template TEXT,
    auto_resolve BOOLEAN, config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    active_window JSONB,
    trigger_once BOOLEAN,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT * FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND r.deleted_at IS NULL
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT total.c, r.id, r.organization_id, r.name, r.kind, r.enabled,
        r.severity, r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        COALESCE(dest_ch.destination_channel_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by, r.delivery_mode,
        r.digest_window_minutes, r.runbook_url, r.template_id, r.active_window,
        r.trigger_once,
        lf.last_fired_at, r.created_at, r.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT * FROM filtered ORDER BY name ASC LIMIT p_limit OFFSET p_offset
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(c.channel_id ORDER BY c.channel_id ASC) AS destination_channel_ids
        FROM notifications.alert_rule_destination_channels c WHERE c.rule_id = r.id
    ) dest_ch ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(t.created_at) AS last_fired_at
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances ai ON ai.id = t.alert_id
        WHERE ai.rule_id = r.id
          AND t.action = 'triggered'
    ) lf ON TRUE;
$$;
