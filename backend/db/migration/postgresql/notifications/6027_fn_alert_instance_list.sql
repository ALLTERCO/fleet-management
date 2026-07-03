--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_list(
    p_organization_id   VARCHAR,
    p_state             VARCHAR DEFAULT NULL,
    p_severity          VARCHAR DEFAULT NULL,
    p_rule_id           INTEGER DEFAULT NULL,
    p_source_type       VARCHAR DEFAULT NULL,
    p_source_id         VARCHAR DEFAULT NULL,
    p_location_ids      INTEGER[] DEFAULT NULL,
    p_group_ids         INTEGER[] DEFAULT NULL,
    p_tag_ids           INTEGER[] DEFAULT NULL,
    p_query             VARCHAR DEFAULT NULL,
    p_limit             INTEGER DEFAULT 200,
    p_offset            INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count                   BIGINT,
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
    WITH filtered AS (
        SELECT ai.*
        FROM notifications.alert_instances ai
        WHERE ai.organization_id = p_organization_id
          AND (p_state IS NULL OR ai.state = p_state)
          AND (p_severity IS NULL OR ai.severity = p_severity)
          AND (p_rule_id IS NULL OR ai.rule_id = p_rule_id)
          AND (p_source_type IS NULL OR ai.source_subject_type = p_source_type)
          AND (p_source_id IS NULL OR ai.source_subject_id = p_source_id)
          AND (
              p_query IS NULL
              OR ai.title ILIKE '%' || p_query || '%'
              OR ai.message ILIKE '%' || p_query || '%'
              OR ai.fingerprint ILIKE '%' || p_query || '%'
              OR ai.source_subject_id ILIKE '%' || p_query || '%'
          )
          AND (
              p_location_ids IS NULL
              OR (
                  ai.source_subject_type = 'location'
                  AND ai.source_subject_id = ANY(
                      ARRAY(SELECT location_id::VARCHAR FROM unnest(p_location_ids) location_id)
                  )
              )
              OR EXISTS (
                  SELECT 1
                  FROM organization.location_assignments la
                  WHERE la.organization_id = ai.organization_id
                    AND la.location_id = ANY(p_location_ids)
                    AND (
                        (
                            ai.source_subject_type = 'device'
                            AND la.subject_type = 'device'
                            AND la.subject_id = ai.source_subject_id
                        )
                        OR (
                            ai.source_subject_type = 'entity'
                            AND (
                                (
                                    la.subject_type = 'entity'
                                    AND la.subject_id = ai.source_subject_id
                                )
                                OR (
                                    la.subject_type = 'device'
                                    AND substring(ai.source_subject_id FOR length(la.subject_id) + 1) = la.subject_id || '_'
                                )
                            )
                        )
                    )
              )
          )
          AND (
              p_group_ids IS NULL
              OR (
                  ai.source_subject_type = 'group'
                  AND ai.source_subject_id = ANY(
                      ARRAY(SELECT group_id::VARCHAR FROM unnest(p_group_ids) group_id)
                  )
              )
              OR EXISTS (
                  SELECT 1
                  FROM organization.group_members gm
                  WHERE gm.organization_id = ai.organization_id
                    AND gm.group_id = ANY(p_group_ids)
                    AND (
                        (
                            ai.source_subject_type = 'device'
                            AND gm.subject_type = 'device'
                            AND gm.subject_id = ai.source_subject_id
                        )
                        OR (
                            ai.source_subject_type = 'entity'
                            AND (
                                (
                                    gm.subject_type = 'entity'
                                    AND gm.subject_id = ai.source_subject_id
                                )
                                OR (
                                    gm.subject_type = 'device'
                                    AND substring(ai.source_subject_id FOR length(gm.subject_id) + 1) = gm.subject_id || '_'
                                )
                            )
                        )
                        OR (
                            ai.source_subject_type = 'location'
                            AND gm.subject_type = 'location'
                            AND gm.subject_id = ai.source_subject_id
                        )
                    )
              )
          )
          AND (
              p_tag_ids IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM organization.tag_assignments ta
                  WHERE ta.organization_id = ai.organization_id
                    AND ta.tag_id = ANY(p_tag_ids)
                    AND (
                        (
                            ta.subject_type = ai.source_subject_type
                            AND ta.subject_id = ai.source_subject_id
                        )
                        OR (
                            ai.source_subject_type = 'entity'
                            AND ta.subject_type = 'device'
                            AND substring(ai.source_subject_id FOR length(ta.subject_id) + 1) = ta.subject_id || '_'
                        )
                    )
              )
          )
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
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
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE state
                WHEN 'active' THEN 0
                WHEN 'acknowledged' THEN 1
                ELSE 2
            END ASC,
            last_triggered_at DESC,
            id DESC
        LIMIT p_limit OFFSET p_offset
    ) ai ON TRUE;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_instance_list;
