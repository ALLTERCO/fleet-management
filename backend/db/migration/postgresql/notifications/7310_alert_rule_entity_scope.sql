--------------UP
CREATE TABLE IF NOT EXISTS notifications.alert_rule_entity_scope (
    id BIGSERIAL PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    rule_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    device_id INTEGER,
    entity_suffix VARCHAR(255),
    virtual_entity_id VARCHAR(255),
    CONSTRAINT alert_rule_entity_scope_rule_fk
        FOREIGN KEY (organization_id, rule_id)
        REFERENCES notifications.alert_rules (organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT alert_rule_entity_scope_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT alert_rule_entity_scope_kind_check CHECK (
        (device_id IS NOT NULL AND entity_suffix IS NOT NULL
            AND entity_suffix <> '' AND virtual_entity_id IS NULL)
        OR
        (device_id IS NULL AND entity_suffix IS NULL
            AND virtual_entity_id IS NOT NULL
            AND virtual_entity_id LIKE '%:virtual')
    ),
    UNIQUE (rule_id, ordinal)
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_rule_entity_scope_identity_unique
    ON notifications.alert_rule_entity_scope (
        rule_id,
        COALESCE(device_id::TEXT || '_' || entity_suffix, virtual_entity_id)
    );

CREATE INDEX IF NOT EXISTS alert_rule_entity_scope_device_idx
    ON notifications.alert_rule_entity_scope (organization_id, device_id)
    WHERE device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_entity_scope_replace(
    p_organization_id VARCHAR,
    p_rule_id INTEGER,
    p_entity_ids JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE expected_count INTEGER;
DECLARE stored_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM notifications.alert_rules
         WHERE organization_id = p_organization_id AND id = p_rule_id
    ) THEN
        RAISE EXCEPTION 'alert rule does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'alert_rule';
    END IF;

    DELETE FROM notifications.alert_rule_entity_scope
     WHERE organization_id = p_organization_id AND rule_id = p_rule_id;

    WITH items AS (
        SELECT DISTINCT ON (item.entity_id)
               item.entity_id, item.ordinality - 1 AS ordinal
          FROM jsonb_array_elements_text(COALESCE(p_entity_ids, '[]'::jsonb))
               WITH ORDINALITY AS item(entity_id, ordinality)
         ORDER BY item.entity_id, item.ordinality
    )
    INSERT INTO notifications.alert_rule_entity_scope (
        organization_id, rule_id, ordinal, virtual_entity_id
    )
    SELECT p_organization_id, p_rule_id, items.ordinal, items.entity_id
      FROM items
     WHERE items.entity_id LIKE '%:virtual';

    WITH items AS (
        SELECT DISTINCT ON (item.entity_id)
               item.entity_id, item.ordinality - 1 AS ordinal
          FROM jsonb_array_elements_text(COALESCE(p_entity_ids, '[]'::jsonb))
               WITH ORDINALITY AS item(entity_id, ordinality)
         ORDER BY item.entity_id, item.ordinality
    )
    INSERT INTO notifications.alert_rule_entity_scope (
        organization_id, rule_id, ordinal, device_id, entity_suffix
    )
    SELECT p_organization_id, p_rule_id, items.ordinal,
           normalized.device_id, normalized.entity_suffix
      FROM items
     CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
         p_organization_id, items.entity_id
     ) normalized
     WHERE items.entity_id NOT LIKE '%:virtual'
       AND normalized.device_id IS NOT NULL
       AND normalized.entity_suffix IS NOT NULL;

    SELECT count(DISTINCT item.entity_id)
      INTO expected_count
      FROM jsonb_array_elements_text(COALESCE(p_entity_ids, '[]'::jsonb))
           AS item(entity_id);
    SELECT count(*) INTO stored_count
      FROM notifications.alert_rule_entity_scope
     WHERE organization_id = p_organization_id AND rule_id = p_rule_id;

    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'alert rule contains unresolved physical entity references'
            USING ERRCODE = '23503', DETAIL = 'entity';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_subject_scope_replace(
    p_organization_id VARCHAR,
    p_rule_id INTEGER,
    p_scope JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM notifications.fn_alert_rule_device_scope_replace(
        p_organization_id,
        p_rule_id,
        COALESCE(p_scope->'deviceIds', '[]'::jsonb)
    );
    PERFORM notifications.fn_alert_rule_entity_scope_replace(
        p_organization_id,
        p_rule_id,
        COALESCE(p_scope->'componentIds', '[]'::jsonb)
            || COALESCE(p_scope->'entityIds', '[]'::jsonb)
    );
END;
$$;

DO $$
DECLARE rule_row RECORD;
BEGIN
    FOR rule_row IN
        SELECT organization_id, id, scope
          FROM notifications.alert_rules
    LOOP
        PERFORM notifications.fn_alert_rule_entity_scope_replace(
            rule_row.organization_id,
            rule_row.id,
            COALESCE(rule_row.scope->'componentIds', '[]'::jsonb)
                || COALESCE(rule_row.scope->'entityIds', '[]'::jsonb)
        );
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_scopes_public(
    p_organization_id VARCHAR,
    p_rule_ids INTEGER[]
)
RETURNS TABLE (rule_id INTEGER, scope JSONB)
LANGUAGE sql STABLE AS $$
    SELECT r.id,
           (r.scope - 'deviceIds' - 'componentIds' - 'entityIds')
           || COALESCE(devices.public_scope, '{}'::jsonb)
           || COALESCE(entities.public_scope, '{}'::jsonb)
      FROM notifications.alert_rules r
      LEFT JOIN LATERAL (
          SELECT jsonb_build_object(
                     'deviceIds', jsonb_agg(d.external_id ORDER BY d.external_id)
                 ) AS public_scope
            FROM notifications.alert_rule_device_scope ds
            JOIN device.list d
              ON d.organization_id = ds.organization_id
             AND d.id = ds.device_id
           WHERE ds.organization_id = r.organization_id
             AND ds.rule_id = r.id
          HAVING count(*) > 0
      ) devices ON TRUE
      LEFT JOIN LATERAL (
          SELECT jsonb_build_object(
                     'componentIds', jsonb_agg(
                         COALESCE(
                             d.external_id || '_' || es.entity_suffix,
                             es.virtual_entity_id
                         ) ORDER BY es.ordinal
                     )
                 ) AS public_scope
            FROM notifications.alert_rule_entity_scope es
            LEFT JOIN device.list d
              ON d.organization_id = es.organization_id
             AND d.id = es.device_id
           WHERE es.organization_id = r.organization_id
             AND es.rule_id = r.id
          HAVING count(*) > 0
      ) entities ON TRUE
     WHERE r.organization_id = p_organization_id
       AND r.id = ANY(p_rule_ids);
$$;

--------------DOWN
-- Forward-only logical identity migration.
