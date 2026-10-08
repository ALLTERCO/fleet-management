--------------UP
-- Dashboard ownership and lifecycle activity are part of the authoritative
-- database mutation, not a best-effort application-side projection.

CREATE OR REPLACE FUNCTION ui.fn_dashboard_assignment_activity(
    p_organization_id VARCHAR,
    p_actor_user_id   VARCHAR,
    p_event_kind      VARCHAR,
    p_assignment_id   TEXT,
    p_subject_type    VARCHAR,
    p_subject_id      TEXT,
    p_persona_id      TEXT,
    p_scope           JSONB,
    p_require_target  BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_dashboard_id INTEGER;
    v_owned        BOOLEAN;
BEGIN
    IF p_scope ? 'dashboard_ids'
       AND jsonb_typeof(p_scope->'dashboard_ids') <> 'array' THEN
        RAISE EXCEPTION 'dashboard_ids must be an array'
            USING ERRCODE = '22023';
    END IF;

    FOR v_dashboard_id IN
        SELECT DISTINCT value::INTEGER
          FROM jsonb_array_elements_text(
              COALESCE(p_scope->'dashboard_ids', '[]'::JSONB)
          ) ids(value)
    LOOP
        SELECT EXISTS (
            SELECT 1
              FROM ui.dashboard d
             WHERE d.id = v_dashboard_id
               AND d.organization_id = p_organization_id
        ) INTO v_owned;

        IF NOT v_owned THEN
            IF p_require_target THEN
                RAISE EXCEPTION 'dashboard % does not belong to organization %',
                    v_dashboard_id, p_organization_id
                    USING ERRCODE = '23503';
            END IF;
            CONTINUE;
        END IF;

        INSERT INTO ui.dashboard_activity_log (
            dashboard_id, organization_id, actor_user_id, event_kind, detail
        ) VALUES (
            v_dashboard_id,
            p_organization_id,
            p_actor_user_id,
            p_event_kind,
            jsonb_build_object(
                'assignmentId', p_assignment_id,
                'subjectType', p_subject_type,
                'subjectId', p_subject_id,
                'personaId', p_persona_id
            )
        );
    END LOOP;
END;
$$;

-- Wrap the existing assignment SoT. A failure to append activity rolls back
-- the assignment insert in the same PostgreSQL transaction.
CREATE OR REPLACE FUNCTION organization.fn_assignment_create_with_dashboard_activity(
    p_tenant_id             VARCHAR,
    p_subject_type          VARCHAR,
    p_subject_id            VARCHAR,
    p_persona_id            UUID,
    p_scope                 JSONB,
    p_created_by            VARCHAR,
    p_reason                TEXT,
    p_comment               TEXT,
    p_expires_at            TIMESTAMPTZ,
    p_activity_actor_user_id VARCHAR
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ,
    reason TEXT,
    comment TEXT,
    expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_assignment RECORD;
BEGIN
    SELECT * INTO v_assignment
      FROM organization.fn_assignment_create(
          p_tenant_id, p_subject_type, p_subject_id, p_persona_id,
          p_scope, p_created_by, p_reason, p_comment, p_expires_at
      );
    IF NOT FOUND THEN RETURN; END IF;

    PERFORM ui.fn_dashboard_assignment_activity(
        p_tenant_id,
        p_activity_actor_user_id,
        'shared',
        v_assignment.id,
        p_subject_type,
        p_subject_id,
        p_persona_id::TEXT,
        v_assignment.scope,
        TRUE
    );

    RETURN QUERY SELECT
        v_assignment.id::TEXT,
        v_assignment.tenant_id::TEXT,
        v_assignment.subject_type::VARCHAR,
        v_assignment.subject_id::TEXT,
        v_assignment.persona_id::TEXT,
        v_assignment.scope::JSONB,
        v_assignment.created_at::TIMESTAMPTZ,
        v_assignment.created_by::TEXT,
        v_assignment.last_used_at::TIMESTAMPTZ,
        v_assignment.reason::TEXT,
        v_assignment.comment::TEXT,
        v_assignment.expires_at::TIMESTAMPTZ;
END;
$$;

-- Resolve the assignment before deletion, then delete through the existing
-- tenant-scoped SoT and append unshare activity before returning.
CREATE OR REPLACE FUNCTION organization.fn_assignment_delete_with_dashboard_activity(
    p_id                     UUID,
    p_tenant_id              VARCHAR,
    p_activity_actor_user_id VARCHAR
)
RETURNS TABLE (id TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_assignment RECORD;
    v_deleted_id TEXT;
BEGIN
    SELECT a.subject_type,
           a.subject_id::TEXT AS subject_id,
           a.persona_id::TEXT AS persona_id,
           organization.fn_assignment_scope_external(a.id, a.scope) AS scope
      INTO v_assignment
      FROM organization.assignments a
     WHERE a.id = p_id
       AND a.tenant_id = p_tenant_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT deleted.id INTO v_deleted_id
      FROM organization.fn_assignment_delete(p_id, p_tenant_id) deleted;
    IF NOT FOUND THEN RETURN; END IF;

    PERFORM ui.fn_dashboard_assignment_activity(
        p_tenant_id,
        p_activity_actor_user_id,
        'unshared',
        v_deleted_id,
        v_assignment.subject_type,
        v_assignment.subject_id,
        v_assignment.persona_id,
        v_assignment.scope,
        FALSE
    );

    RETURN QUERY SELECT v_deleted_id;
END;
$$;

-- One canonical insert supports both normal create and import. Items, owner,
-- settings, and the created activity row commit or roll back together.
DROP FUNCTION IF EXISTS ui.fn_dashboard_add_scoped(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, VARCHAR
);
CREATE FUNCTION ui.fn_dashboard_add_scoped(
    p_organization_id VARCHAR,
    p_name            VARCHAR(300),
    p_dashboard_type  VARCHAR(20),
    p_location_id     INTEGER DEFAULT NULL,
    p_group_id        INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL,
    p_owner_user_id   VARCHAR(120) DEFAULT NULL,
    p_items           JSONB DEFAULT '[]'::JSONB,
    p_activity_detail JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    owner_user_id   VARCHAR,
    name            VARCHAR,
    dashboard_type  VARCHAR,
    location_id     INTEGER,
    group_id        INTEGER,
    tag_id          INTEGER,
    created         TIMESTAMPTZ,
    updated         TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    PERFORM ui.fn_dashboard_assert_scope_valid(
        p_organization_id, p_location_id, p_group_id, p_tag_id
    );
    IF jsonb_typeof(COALESCE(p_items, '[]'::JSONB)) <> 'array' THEN
        RAISE EXCEPTION 'dashboard items must be an array'
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(COALESCE(p_activity_detail, '{}'::JSONB)) <> 'object' THEN
        RAISE EXCEPTION 'dashboard activity detail must be an object'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO ui.dashboard (
        organization_id, owner_user_id, name, dashboard_type,
        location_id, group_id, tag_id
    ) VALUES (
        p_organization_id, p_owner_user_id, p_name, p_dashboard_type,
        p_location_id, p_group_id, p_tag_id
    ) RETURNING ui.dashboard.id INTO r_id;

    IF p_dashboard_type IN (
        'analytics','overview','energy','environment','control','safety'
    ) THEN
        INSERT INTO ui.dashboard_settings (dashboard_id) VALUES (r_id);
    END IF;

    IF jsonb_array_length(COALESCE(p_items, '[]'::JSONB)) > 0 THEN
        PERFORM ui.fn_dashboard_item_set_all(r_id, p_items);
    END IF;

    INSERT INTO ui.dashboard_activity_log (
        dashboard_id, organization_id, actor_user_id, event_kind, detail
    ) VALUES (
        r_id,
        p_organization_id,
        p_owner_user_id,
        'created',
        jsonb_build_object('source', 'create', 'name', p_name)
            || COALESCE(p_activity_detail, '{}'::JSONB)
    );

    RETURN QUERY
    SELECT d.id, d.organization_id, d.owner_user_id, d.name,
           d.dashboard_type, d.location_id, d.group_id, d.tag_id,
           d.created, d.updated
      FROM ui.dashboard d
     WHERE d.id = r_id;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_clone(
    INTEGER, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, VARCHAR
);
CREATE FUNCTION ui.fn_dashboard_clone(
    p_source_id       INTEGER,
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_group_id        INTEGER DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL,
    p_owner_user_id   VARCHAR(120) DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    r_new_id INTEGER;
BEGIN
    INSERT INTO ui.dashboard (
        organization_id, owner_user_id, name, dashboard_type,
        group_id, location_id, tag_id
    )
    SELECT p_organization_id, p_owner_user_id, p_name, dashboard_type,
           p_group_id, p_location_id, p_tag_id
      FROM ui.dashboard
     WHERE id = p_source_id
       AND organization_id = p_organization_id
    RETURNING id INTO r_new_id;

    IF r_new_id IS NULL THEN RETURN NULL; END IF;

    INSERT INTO ui.dashboard_item (
        dashboard, kind, "order", size, mobile_layout,
        device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
        widget_kind, widget_config, grid_x, grid_y, grid_w, grid_h
    )
    SELECT r_new_id, kind, "order", size, mobile_layout,
           device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
           widget_kind, widget_config, grid_x, grid_y, grid_w, grid_h
      FROM ui.dashboard_item
     WHERE dashboard = p_source_id;

    INSERT INTO ui.dashboard_activity_log (
        dashboard_id, organization_id, actor_user_id, event_kind, detail
    ) VALUES (
        r_new_id,
        p_organization_id,
        p_owner_user_id,
        'cloned',
        jsonb_build_object('sourceId', p_source_id, 'name', p_name)
    );

    RETURN r_new_id;
END;
$$;

-- Owner is part of the canonical Dashboard wire object.
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch_v2(VARCHAR, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_fetch_v2(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id              INT,
    name            VARCHAR(300),
    group_id        INT,
    location_id     INT,
    tag_id          INT,
    dashboard_type  VARCHAR(20),
    organization_id VARCHAR(120),
    owner_user_id   VARCHAR(120),
    is_default      BOOLEAN,
    is_pinned       BOOLEAN,
    display_order   INTEGER,
    created         TIMESTAMPTZ,
    updated         TIMESTAMPTZ,
    settings        JSONB,
    items           JSONB
)
LANGUAGE sql
AS $$
    SELECT
        d.id, d.name, d.group_id, d.location_id, d.tag_id,
        d.dashboard_type, d.organization_id, d.owner_user_id, d.is_default,
        EXISTS (
            SELECT 1 FROM ui.dashboard_pin p
             WHERE p.dashboard_id = d.id AND p.user_id = p_user_id
        ) AS is_pinned,
        ord.display_order,
        d.created, d.updated,
        COALESCE(
            (SELECT to_jsonb(s) - 'id' - 'dashboard_id' - 'created' - 'updated'
               FROM ui.dashboard_settings s
              WHERE s.dashboard_id = d.id LIMIT 1),
            '{}'::jsonb
        ) AS settings,
        COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', di.id,
                    'kind', di.kind,
                    'deviceId', di.device_id,
                    'entitySubId', di.entity_sub_id,
                    'groupId', di.group_id,
                    'locationId', di.location_id,
                    'tagId', di.tag_id,
                    'actionId', di.action_id,
                    'widgetKind', di.widget_kind,
                    'widgetConfig', di.widget_config,
                    'order', di."order",
                    'size', COALESCE(di.size, '1x1'),
                    'mobileLayout', di.mobile_layout,
                    'gridX', di.grid_x,
                    'gridY', di.grid_y,
                    'gridW', di.grid_w,
                    'gridH', di.grid_h
                ) ORDER BY di."order", di.id
             ) FROM ui.dashboard_item di WHERE di.dashboard = d.id),
            '[]'::jsonb
        ) AS items
    FROM ui.dashboard d
    LEFT JOIN ui.dashboard_order_user ord
           ON ord.dashboard_id = d.id
          AND ord.user_id = p_user_id
    WHERE d.organization_id = p_organization_id
    ORDER BY ord.display_order NULLS LAST, d.id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_assignment_delete_with_dashboard_activity(
    UUID, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS organization.fn_assignment_create_with_dashboard_activity(
    VARCHAR, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR, TEXT, TEXT, TIMESTAMPTZ, VARCHAR
);
DROP FUNCTION IF EXISTS ui.fn_dashboard_assignment_activity(
    VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, TEXT, TEXT, JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS ui.fn_dashboard_add_scoped(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, VARCHAR, JSONB, JSONB
);

CREATE FUNCTION ui.fn_dashboard_add_scoped(
    p_organization_id VARCHAR,
    p_name            VARCHAR(300),
    p_dashboard_type  VARCHAR(20),
    p_location_id     INTEGER DEFAULT NULL,
    p_group_id        INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL,
    p_owner_user_id   VARCHAR(120) DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR,
    dashboard_type VARCHAR, location_id INTEGER, group_id INTEGER,
    tag_id INTEGER, created TIMESTAMPTZ, updated TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    PERFORM ui.fn_dashboard_assert_scope_valid(
        p_organization_id, p_location_id, p_group_id, p_tag_id
    );
    INSERT INTO ui.dashboard (
        organization_id, owner_user_id, name, dashboard_type,
        location_id, group_id, tag_id
    ) VALUES (
        p_organization_id, p_owner_user_id, p_name, p_dashboard_type,
        p_location_id, p_group_id, p_tag_id
    ) RETURNING ui.dashboard.id INTO r_id;
    IF p_dashboard_type IN (
        'analytics','overview','energy','environment','control','safety'
    ) THEN
        INSERT INTO ui.dashboard_settings (dashboard_id) VALUES (r_id);
    END IF;
    RETURN QUERY
    SELECT d.id, d.organization_id, d.name, d.dashboard_type,
           d.location_id, d.group_id, d.tag_id, d.created, d.updated
      FROM ui.dashboard d
     WHERE d.id = r_id;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_clone(
    INTEGER, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, VARCHAR
);
CREATE FUNCTION ui.fn_dashboard_clone(
    p_source_id       INTEGER,
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_group_id        INTEGER DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL,
    p_owner_user_id   VARCHAR(120) DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    r_new_id INTEGER;
BEGIN
    INSERT INTO ui.dashboard (
        organization_id, owner_user_id, name, dashboard_type,
        group_id, location_id, tag_id
    )
    SELECT p_organization_id, p_owner_user_id, p_name, dashboard_type,
           p_group_id, p_location_id, p_tag_id
      FROM ui.dashboard
     WHERE id = p_source_id
    RETURNING id INTO r_new_id;
    INSERT INTO ui.dashboard_item (
        dashboard, kind, "order", size, mobile_layout,
        device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
        widget_kind, widget_config
    )
    SELECT r_new_id, kind, "order", size, mobile_layout,
           device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
           widget_kind, widget_config
      FROM ui.dashboard_item
     WHERE dashboard = p_source_id;
    RETURN r_new_id;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch_v2(VARCHAR, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_fetch_v2(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id INT, name VARCHAR(300), group_id INT, location_id INT, tag_id INT,
    dashboard_type VARCHAR(20), organization_id VARCHAR(120),
    is_default BOOLEAN, is_pinned BOOLEAN, display_order INTEGER,
    created TIMESTAMPTZ, updated TIMESTAMPTZ, settings JSONB, items JSONB
)
LANGUAGE sql
AS $$
    SELECT
        d.id, d.name, d.group_id, d.location_id, d.tag_id,
        d.dashboard_type, d.organization_id, d.is_default,
        EXISTS (
            SELECT 1 FROM ui.dashboard_pin p
             WHERE p.dashboard_id = d.id AND p.user_id = p_user_id
        ) AS is_pinned,
        ord.display_order, d.created, d.updated,
        COALESCE(
            (SELECT to_jsonb(s) - 'id' - 'dashboard_id' - 'created' - 'updated'
               FROM ui.dashboard_settings s
              WHERE s.dashboard_id = d.id LIMIT 1),
            '{}'::jsonb
        ) AS settings,
        COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', di.id, 'kind', di.kind, 'deviceId', di.device_id,
                    'entitySubId', di.entity_sub_id, 'groupId', di.group_id,
                    'locationId', di.location_id, 'tagId', di.tag_id,
                    'actionId', di.action_id, 'widgetKind', di.widget_kind,
                    'widgetConfig', di.widget_config, 'order', di."order",
                    'size', COALESCE(di.size, '1x1'),
                    'mobileLayout', di.mobile_layout,
                    'gridX', di.grid_x, 'gridY', di.grid_y,
                    'gridW', di.grid_w, 'gridH', di.grid_h
                ) ORDER BY di."order", di.id
             ) FROM ui.dashboard_item di WHERE di.dashboard = d.id),
            '[]'::jsonb
        ) AS items
    FROM ui.dashboard d
    LEFT JOIN ui.dashboard_order_user ord
           ON ord.dashboard_id = d.id AND ord.user_id = p_user_id
    WHERE d.organization_id = p_organization_id
    ORDER BY ord.display_order NULLS LAST, d.id;
$$;
