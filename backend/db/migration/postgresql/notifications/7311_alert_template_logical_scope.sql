--------------UP
CREATE UNIQUE INDEX IF NOT EXISTS alert_rule_templates_org_id_unique
    ON notifications.alert_rule_templates (organization_id, id);

CREATE TABLE IF NOT EXISTS notifications.alert_rule_template_scope_state (
    template_id INTEGER PRIMARY KEY
        REFERENCES notifications.alert_rule_templates(id) ON DELETE CASCADE,
    device_scope_is_set BOOLEAN NOT NULL DEFAULT FALSE,
    entity_scope_is_set BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS notifications.alert_rule_template_device_scope (
    organization_id VARCHAR(120) NOT NULL,
    template_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    device_id INTEGER NOT NULL,
    PRIMARY KEY (template_id, device_id),
    UNIQUE (template_id, ordinal),
    FOREIGN KEY (organization_id, template_id)
        REFERENCES notifications.alert_rule_templates (organization_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS alert_rule_template_device_scope_device_idx
    ON notifications.alert_rule_template_device_scope (
        organization_id, device_id
    );

CREATE TABLE IF NOT EXISTS notifications.alert_rule_template_entity_scope (
    id BIGSERIAL PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    template_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    device_id INTEGER,
    entity_suffix VARCHAR(255),
    virtual_entity_id VARCHAR(255),
    FOREIGN KEY (organization_id, template_id)
        REFERENCES notifications.alert_rule_templates (organization_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT alert_rule_template_entity_scope_kind_check CHECK (
        (device_id IS NOT NULL AND entity_suffix IS NOT NULL
            AND entity_suffix <> '' AND virtual_entity_id IS NULL)
        OR
        (device_id IS NULL AND entity_suffix IS NULL
            AND virtual_entity_id IS NOT NULL
            AND virtual_entity_id LIKE '%:virtual')
    ),
    UNIQUE (template_id, ordinal)
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_rule_template_entity_scope_identity_unique
    ON notifications.alert_rule_template_entity_scope (
        template_id,
        COALESCE(device_id::TEXT || '_' || entity_suffix, virtual_entity_id)
    );

CREATE INDEX IF NOT EXISTS alert_rule_template_entity_scope_device_idx
    ON notifications.alert_rule_template_entity_scope (
        organization_id, device_id
    ) WHERE device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_scope_replace(
    p_organization_id VARCHAR,
    p_template_id INTEGER,
    p_scope JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE expected_devices INTEGER;
DECLARE expected_entities INTEGER;
DECLARE stored_devices INTEGER;
DECLARE stored_entities INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM notifications.alert_rule_templates
         WHERE organization_id = p_organization_id AND id = p_template_id
    ) THEN
        RAISE EXCEPTION 'alert rule template does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'alert_rule_template';
    END IF;

    DELETE FROM notifications.alert_rule_template_device_scope
     WHERE organization_id = p_organization_id AND template_id = p_template_id;
    DELETE FROM notifications.alert_rule_template_entity_scope
     WHERE organization_id = p_organization_id AND template_id = p_template_id;

    INSERT INTO notifications.alert_rule_template_scope_state (
        template_id, device_scope_is_set, entity_scope_is_set
    ) VALUES (
        p_template_id,
        COALESCE(p_scope, '{}'::jsonb) ? 'deviceIds',
        (COALESCE(p_scope, '{}'::jsonb) ? 'componentIds')
            OR (COALESCE(p_scope, '{}'::jsonb) ? 'entityIds')
    )
    ON CONFLICT (template_id) DO UPDATE SET
        device_scope_is_set = EXCLUDED.device_scope_is_set,
        entity_scope_is_set = EXCLUDED.entity_scope_is_set;

    WITH items AS (
        SELECT DISTINCT ON (item.external_id)
               item.external_id, item.ordinality - 1 AS ordinal
          FROM jsonb_array_elements_text(
              COALESCE(p_scope->'deviceIds', '[]'::jsonb)
          ) WITH ORDINALITY AS item(external_id, ordinality)
         ORDER BY item.external_id, item.ordinality
    )
    INSERT INTO notifications.alert_rule_template_device_scope (
        organization_id, template_id, ordinal, device_id
    )
    SELECT p_organization_id, p_template_id, items.ordinal, d.id
      FROM items
      JOIN device.list d
        ON d.organization_id = p_organization_id
       AND d.external_id = items.external_id;

    WITH items AS (
        SELECT DISTINCT ON (item.entity_id)
               item.entity_id, item.ordinality - 1 AS ordinal
          FROM jsonb_array_elements_text(
              COALESCE(p_scope->'componentIds', '[]'::jsonb)
                  || COALESCE(p_scope->'entityIds', '[]'::jsonb)
          ) WITH ORDINALITY AS item(entity_id, ordinality)
         ORDER BY item.entity_id, item.ordinality
    )
    INSERT INTO notifications.alert_rule_template_entity_scope (
        organization_id, template_id, ordinal, virtual_entity_id
    )
    SELECT p_organization_id, p_template_id, items.ordinal, items.entity_id
      FROM items
     WHERE items.entity_id LIKE '%:virtual';

    WITH items AS (
        SELECT DISTINCT ON (item.entity_id)
               item.entity_id, item.ordinality - 1 AS ordinal
          FROM jsonb_array_elements_text(
              COALESCE(p_scope->'componentIds', '[]'::jsonb)
                  || COALESCE(p_scope->'entityIds', '[]'::jsonb)
          ) WITH ORDINALITY AS item(entity_id, ordinality)
         ORDER BY item.entity_id, item.ordinality
    )
    INSERT INTO notifications.alert_rule_template_entity_scope (
        organization_id, template_id, ordinal, device_id, entity_suffix
    )
    SELECT p_organization_id, p_template_id, items.ordinal,
           normalized.device_id, normalized.entity_suffix
      FROM items
     CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
         p_organization_id, items.entity_id
     ) normalized
     WHERE items.entity_id NOT LIKE '%:virtual'
       AND normalized.device_id IS NOT NULL
       AND normalized.entity_suffix IS NOT NULL;

    SELECT count(DISTINCT item.external_id) INTO expected_devices
      FROM jsonb_array_elements_text(
          COALESCE(p_scope->'deviceIds', '[]'::jsonb)
      ) item(external_id);
    SELECT count(DISTINCT item.entity_id) INTO expected_entities
      FROM jsonb_array_elements_text(
          COALESCE(p_scope->'componentIds', '[]'::jsonb)
              || COALESCE(p_scope->'entityIds', '[]'::jsonb)
      ) item(entity_id);
    SELECT count(*) INTO stored_devices
      FROM notifications.alert_rule_template_device_scope
     WHERE template_id = p_template_id;
    SELECT count(*) INTO stored_entities
      FROM notifications.alert_rule_template_entity_scope
     WHERE template_id = p_template_id;

    IF expected_devices <> stored_devices THEN
        RAISE EXCEPTION 'alert template contains unresolved device references'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;
    IF expected_entities <> stored_entities THEN
        RAISE EXCEPTION 'alert template contains unresolved physical entity references'
            USING ERRCODE = '23503', DETAIL = 'entity';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_scope_owner_prepare()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
        DELETE FROM notifications.alert_rule_template_device_scope
         WHERE template_id = NEW.id;
        DELETE FROM notifications.alert_rule_template_entity_scope
         WHERE template_id = NEW.id;
        DELETE FROM notifications.alert_rule_template_scope_state
         WHERE template_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alert_rule_template_scope_owner_prepare
    ON notifications.alert_rule_templates;
CREATE TRIGGER alert_rule_template_scope_owner_prepare
BEFORE UPDATE OF organization_id
ON notifications.alert_rule_templates
FOR EACH ROW
EXECUTE FUNCTION notifications.fn_alert_rule_template_scope_owner_prepare();

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_scope_sync()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        DELETE FROM notifications.alert_rule_template_device_scope
         WHERE template_id = NEW.id;
        DELETE FROM notifications.alert_rule_template_entity_scope
         WHERE template_id = NEW.id;
        DELETE FROM notifications.alert_rule_template_scope_state
         WHERE template_id = NEW.id;
        RETURN NEW;
    END IF;
    PERFORM notifications.fn_alert_rule_template_scope_replace(
        NEW.organization_id, NEW.id, NEW.scope
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alert_rule_template_scope_sync
    ON notifications.alert_rule_templates;
CREATE TRIGGER alert_rule_template_scope_sync
AFTER INSERT OR UPDATE OF organization_id, scope
ON notifications.alert_rule_templates
FOR EACH ROW EXECUTE FUNCTION notifications.fn_alert_rule_template_scope_sync();

DO $$
DECLARE template_row RECORD;
BEGIN
    FOR template_row IN
        SELECT organization_id, id, scope
          FROM notifications.alert_rule_templates
         WHERE organization_id IS NOT NULL
    LOOP
        PERFORM notifications.fn_alert_rule_template_scope_replace(
            template_row.organization_id,
            template_row.id,
            template_row.scope
        );
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_scope_public(
    p_template_id INTEGER,
    p_scope JSONB
)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN state.template_id IS NULL THEN p_scope ELSE
        (COALESCE(p_scope, '{}'::jsonb) - 'deviceIds' - 'componentIds' - 'entityIds')
        || CASE WHEN state.device_scope_is_set THEN jsonb_build_object(
            'deviceIds', COALESCE((
                SELECT jsonb_agg(to_jsonb(d.external_id) ORDER BY refs.ordinal)
                  FROM notifications.alert_rule_template_device_scope refs
                  JOIN device.list d
                    ON d.organization_id = refs.organization_id
                   AND d.id = refs.device_id
                 WHERE refs.template_id = p_template_id
            ), '[]'::jsonb)
        ) ELSE '{}'::jsonb END
        || CASE WHEN state.entity_scope_is_set THEN jsonb_build_object(
            'componentIds', COALESCE((
                SELECT jsonb_agg(to_jsonb(COALESCE(
                    d.external_id || '_' || refs.entity_suffix,
                    refs.virtual_entity_id
                )) ORDER BY refs.ordinal)
                  FROM notifications.alert_rule_template_entity_scope refs
                  LEFT JOIN device.list d
                    ON d.organization_id = refs.organization_id
                   AND d.id = refs.device_id
                 WHERE refs.template_id = p_template_id
            ), '[]'::jsonb)
        ) ELSE '{}'::jsonb END
    END
      FROM (SELECT 1) seed
      LEFT JOIN notifications.alert_rule_template_scope_state state
        ON state.template_id = p_template_id;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_list(VARCHAR, VARCHAR);
CREATE FUNCTION notifications.fn_alert_rule_template_list(
    p_organization_id VARCHAR,
    p_category VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    template_key VARCHAR, category VARCHAR, label VARCHAR, description TEXT,
    kind VARCHAR, severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN
)
LANGUAGE sql STABLE AS $$
    SELECT t.template_key, t.category, t.label, t.description, t.kind,
           t.severity,
           notifications.fn_alert_rule_template_scope_public(t.id, t.scope),
           t.config, t.dedupe_window_sec, t.cooldown_sec,
           t.summary_template, t.message_template, t.auto_resolve
      FROM notifications.alert_rule_templates t
     WHERE (p_category IS NULL OR t.category = p_category)
       AND (t.organization_id = p_organization_id OR t.organization_id IS NULL)
     ORDER BY t.category, t.template_key;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_get(VARCHAR, VARCHAR);
CREATE FUNCTION notifications.fn_alert_rule_template_get(
    p_template_key VARCHAR,
    p_organization_id VARCHAR
)
RETURNS TABLE (
    template_key VARCHAR, category VARCHAR, label VARCHAR, description TEXT,
    kind VARCHAR, severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN
)
LANGUAGE sql STABLE AS $$
    SELECT t.template_key, t.category, t.label, t.description, t.kind,
           t.severity,
           notifications.fn_alert_rule_template_scope_public(t.id, t.scope),
           t.config, t.dedupe_window_sec, t.cooldown_sec,
           t.summary_template, t.message_template, t.auto_resolve
      FROM notifications.alert_rule_templates t
     WHERE t.template_key = p_template_key
       AND (t.organization_id = p_organization_id OR t.organization_id IS NULL)
     ORDER BY (t.organization_id IS NOT NULL) DESC
     LIMIT 1;
$$;

--------------DOWN
-- Forward-only logical identity migration.
