--------------UP
SET search_path TO public;

ALTER TABLE fm.event_journal
    DROP CONSTRAINT IF EXISTS event_journal_resource_kind_check,
    DROP CONSTRAINT IF EXISTS event_journal_check,
    DROP CONSTRAINT IF EXISTS event_journal_shape_check;
ALTER TABLE fm.event_journal
    ADD CONSTRAINT event_journal_resource_kind_check
    CHECK (resource_kind IN ('device', 'group', 'job', 'job-unit')),
    ADD CONSTRAINT event_journal_shape_check CHECK (
        (resource_kind IN ('device', 'group')
            AND job_id IS NULL AND job_kind IS NULL)
        OR (resource_kind = 'job'
            AND job_id = resource_id AND job_kind IS NOT NULL)
        OR (resource_kind = 'job-unit'
            AND job_id IS NOT NULL AND job_kind IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION fm.fn_event_journal_append_resource(
    p_organization_id VARCHAR,
    p_resource_kind VARCHAR,
    p_resource_id VARCHAR,
    p_event_type VARCHAR,
    p_user_id VARCHAR,
    p_payload JSONB,
    p_deduplication_key VARCHAR
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_disallowed_key TEXT;
    v_expected_change TEXT;
BEGIN
    IF p_resource_kind NOT IN ('device', 'group') THEN
        RAISE EXCEPTION 'event journal resource kind is not supported';
    END IF;
    IF p_payload ->> 'event' IS DISTINCT FROM p_event_type
        OR p_payload ->> 'source' IS DISTINCT FROM 'event-distributor'
        OR p_resource_kind = 'device' AND p_event_type NOT IN (
            'Device.Created', 'Device.Updated', 'Device.Deleted'
        )
        OR p_resource_kind = 'group' AND p_event_type NOT IN (
            'Group.Created', 'Group.Updated', 'Group.Deleted',
            'Group.MembersAdded', 'Group.MembersRemoved'
        ) THEN
        RAISE EXCEPTION 'resource event type or source is not allowed';
    END IF;
    SELECT key INTO v_disallowed_key
      FROM jsonb_object_keys(coalesce(p_payload, '{}'::JSONB)) AS key
     WHERE key NOT IN (
        'change', 'event', 'inventorySource', 'memberCount', 'source'
     )
     LIMIT 1;
    IF v_disallowed_key IS NOT NULL THEN
        RAISE EXCEPTION 'resource event payload key is not allowed';
    END IF;
    v_expected_change := CASE p_event_type
        WHEN 'Device.Created' THEN 'created'
        WHEN 'Device.Updated' THEN 'updated'
        WHEN 'Device.Deleted' THEN 'deleted'
        WHEN 'Group.Created' THEN 'created'
        WHEN 'Group.Updated' THEN 'updated'
        WHEN 'Group.Deleted' THEN 'deleted'
        WHEN 'Group.MembersAdded' THEN 'members-added'
        WHEN 'Group.MembersRemoved' THEN 'members-removed'
    END;
    IF p_payload ->> 'change' IS DISTINCT FROM v_expected_change THEN
        RAISE EXCEPTION 'resource event metadata is not allowed';
    END IF;
    IF p_resource_kind = 'device' THEN
        IF NOT (p_payload ? 'inventorySource')
            OR jsonb_typeof(p_payload -> 'inventorySource') <> 'string'
            OR p_payload ->> 'inventorySource' NOT IN (
                'physical', 'virtual', 'bluetooth'
            ) THEN
            RAISE EXCEPTION 'resource event metadata is not allowed';
        END IF;
    ELSIF p_payload ? 'inventorySource' THEN
        RAISE EXCEPTION 'resource event metadata is not allowed';
    END IF;
    IF p_event_type IN ('Group.MembersAdded', 'Group.MembersRemoved') THEN
        IF NOT (p_payload ? 'memberCount') THEN
            RAISE EXCEPTION 'resource event metadata is not allowed';
        END IF;
    ELSIF p_payload ? 'memberCount' THEN
        RAISE EXCEPTION 'resource event metadata is not allowed';
    END IF;
    IF p_payload ? 'memberCount'
        AND (
            jsonb_typeof(p_payload -> 'memberCount') <> 'number'
            OR (p_payload ->> 'memberCount')::NUMERIC < 0
            OR (p_payload ->> 'memberCount')::NUMERIC > 100000
            OR trunc((p_payload ->> 'memberCount')::NUMERIC)
                <> (p_payload ->> 'memberCount')::NUMERIC
        ) THEN
        RAISE EXCEPTION 'resource event member count is invalid';
    END IF;
    RETURN fm.fn_event_journal_insert(
        p_organization_id, p_event_type, p_resource_kind, p_resource_id,
        NULL,
        CASE WHEN p_resource_kind = 'device'
            THEN ARRAY[p_resource_id]
            ELSE ARRAY[]::VARCHAR[]
        END,
        NULL, p_user_id, p_payload, p_deduplication_key
    );
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_read_scoped(
    p_organization_id VARCHAR,
    p_after_id BIGINT,
    p_device_ids VARCHAR[],
    p_group_ids VARCHAR[],
    p_job_ids VARCHAR[],
    p_limit INTEGER
)
RETURNS TABLE (
    rows JSONB,
    next_after_id BIGINT,
    highwater_id BIGINT,
    pruned_through_id BIGINT,
    first_available_id BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH state AS (
        SELECT coalesce(w.highwater_id, 0) AS highwater_id,
               coalesce(w.pruned_through_id, 0) AS pruned_through_id,
               coalesce(
                   (SELECT min(e.id)
                      FROM fm.event_journal AS e
                     WHERE e.organization_id = p_organization_id),
                   coalesce(w.highwater_id, 0) + 1
               ) AS first_available_id
          FROM (SELECT 1) AS anchor
          LEFT JOIN fm.event_journal_watermark AS w
            ON w.organization_id = p_organization_id
    ), page AS (
        SELECT e.*
          FROM fm.event_journal AS e
          CROSS JOIN state AS s
         WHERE e.organization_id = p_organization_id
           AND e.id > coalesce(p_after_id, 0)
           AND e.id <= s.highwater_id
           AND (p_device_ids IS NULL OR e.device_ids && p_device_ids)
           AND (p_group_ids IS NULL OR (
               e.resource_kind = 'group'
               AND e.resource_id = ANY(p_group_ids)
           ))
           AND (p_job_ids IS NULL OR e.job_id = ANY(p_job_ids))
         ORDER BY e.id ASC
         LIMIT least(greatest(coalesce(p_limit, 100), 1), 200)
    ), aggregate_page AS (
        SELECT coalesce(
                   jsonb_agg(
                       to_jsonb(page) || jsonb_build_object('id', page.id::TEXT)
                       ORDER BY id
                   ),
                   '[]'::JSONB
               ) AS rows,
               count(*) AS row_count,
               max(id) AS last_id
          FROM page
    )
    SELECT a.rows,
           CASE
               WHEN a.row_count = least(greatest(coalesce(p_limit, 100), 1), 200)
               THEN a.last_id
               ELSE s.highwater_id
           END AS next_after_id,
           s.highwater_id,
           s.pruned_through_id,
           s.first_available_id
      FROM aggregate_page AS a
      CROSS JOIN state AS s;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_event_journal_read_scoped(
    VARCHAR, BIGINT, VARCHAR[], VARCHAR[], VARCHAR[], INTEGER
);
DROP FUNCTION IF EXISTS fm.fn_event_journal_append_resource(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR
);
ALTER TABLE fm.event_journal
    DROP CONSTRAINT IF EXISTS event_journal_shape_check,
    DROP CONSTRAINT IF EXISTS event_journal_resource_kind_check;
ALTER TABLE fm.event_journal
    ADD CONSTRAINT event_journal_resource_kind_check
    CHECK (resource_kind IN ('device', 'job', 'job-unit')) NOT VALID,
    ADD CONSTRAINT event_journal_check CHECK (
        (resource_kind = 'device' AND job_id IS NULL AND job_kind IS NULL)
        OR (resource_kind = 'job'
            AND job_id = resource_id AND job_kind IS NOT NULL)
        OR (resource_kind = 'job-unit'
            AND job_id IS NOT NULL AND job_kind IS NOT NULL)
    ) NOT VALID;
