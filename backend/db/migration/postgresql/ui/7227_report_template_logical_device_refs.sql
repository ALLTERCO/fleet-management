--------------UP
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_organization_id_id_unique
    ON organization.report_templates (organization_id, id);

CREATE TABLE IF NOT EXISTS ui.report_template_device_selector (
    organization_id VARCHAR(120) NOT NULL,
    template_id UUID NOT NULL,
    selector TEXT NOT NULL CHECK (
        selector IN ('devices', 'main_meter_ids', 'peak_device_ids')
    ),
    PRIMARY KEY (template_id, selector),
    UNIQUE (organization_id, template_id, selector),
    FOREIGN KEY (organization_id, template_id)
        REFERENCES organization.report_templates (organization_id, id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ui.report_template_device_ref (
    organization_id VARCHAR(120) NOT NULL,
    template_id UUID NOT NULL,
    selector TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    device_id INTEGER NOT NULL,
    PRIMARY KEY (template_id, selector, device_id),
    UNIQUE (template_id, selector, ordinal),
    FOREIGN KEY (organization_id, template_id, selector)
        REFERENCES ui.report_template_device_selector (
            organization_id, template_id, selector
        ) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION ui.fn_report_template_device_refs_replace(
    p_organization_id VARCHAR,
    p_template_id UUID,
    p_params JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE expected_count INTEGER;
DECLARE stored_count INTEGER;
BEGIN
    DELETE FROM ui.report_template_device_selector
     WHERE organization_id = p_organization_id
       AND template_id = p_template_id;

    INSERT INTO ui.report_template_device_selector (
        organization_id, template_id, selector
    )
    SELECT p_organization_id, p_template_id, selector.name
      FROM (VALUES
          ('devices'), ('main_meter_ids'), ('peak_device_ids')
      ) selector(name)
     WHERE COALESCE(p_params, '{}'::jsonb) ? selector.name;

    SELECT COALESCE(SUM(jsonb_array_length(p_params->selector)), 0)
      INTO expected_count
      FROM (VALUES
          ('devices'), ('main_meter_ids'), ('peak_device_ids')
      ) names(selector)
     WHERE COALESCE(p_params, '{}'::jsonb) ? selector;

    INSERT INTO ui.report_template_device_ref (
        organization_id, template_id, selector, ordinal, device_id
    )
    SELECT p_organization_id, p_template_id, selector.name,
           item.ordinality - 1, d.id
      FROM (VALUES
          ('devices'), ('main_meter_ids'), ('peak_device_ids')
      ) selector(name)
     CROSS JOIN LATERAL jsonb_array_elements_text(
         COALESCE(p_params->selector.name, '[]'::jsonb)
     ) WITH ORDINALITY AS item(external_id, ordinality)
      JOIN device.list d
        ON d.organization_id = p_organization_id
       AND d.external_id = item.external_id;

    GET DIAGNOSTICS stored_count = ROW_COUNT;
    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'report template contains unresolved device references'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    UPDATE organization.report_templates
       SET params = COALESCE(p_params, '{}'::jsonb)
                    - 'devices' - 'main_meter_ids' - 'peak_device_ids'
     WHERE organization_id = p_organization_id
       AND id = p_template_id;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_report_template_params_public(
    p_template_id UUID,
    p_params JSONB
)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(p_params, '{}'::jsonb) || COALESCE(
        jsonb_object_agg(selectors.selector, selectors.device_ids),
        '{}'::jsonb
    )
      FROM (
          SELECT s.selector,
                 COALESCE(
                     jsonb_agg(to_jsonb(d.external_id) ORDER BY r.ordinal)
                         FILTER (WHERE r.device_id IS NOT NULL),
                     '[]'::jsonb
                 ) AS device_ids
            FROM ui.report_template_device_selector s
            LEFT JOIN ui.report_template_device_ref r
              ON r.template_id = s.template_id
             AND r.selector = s.selector
            LEFT JOIN device.list d ON d.id = r.device_id
           WHERE s.template_id = p_template_id
           GROUP BY s.selector
      ) selectors;
$$;

DO $$
DECLARE template RECORD;
BEGIN
    FOR template IN
        SELECT organization_id, id, params
          FROM organization.report_templates
    LOOP
        PERFORM ui.fn_report_template_device_refs_replace(
            template.organization_id,
            template.id,
            template.params
        );
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ui.fn_reassign_device_ownership(
    p_organization_id VARCHAR,
    p_retained_device_id INTEGER,
    p_temporary_device_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_retained_device_id = p_temporary_device_id THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE organization_id = p_organization_id
           AND id = p_retained_device_id
    ) THEN
        RAISE EXCEPTION 'retained device does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE organization_id = p_organization_id
           AND id = p_temporary_device_id
    ) THEN
        RAISE EXCEPTION 'temporary device does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    UPDATE ui.dashboard_item item
       SET device_id = p_retained_device_id
      FROM ui.dashboard dashboard
     WHERE item.dashboard = dashboard.id
       AND dashboard.organization_id = p_organization_id
       AND item.device_id = p_temporary_device_id;

    -- Existing retained references win when both rows describe one reference.
    DELETE FROM ui.dashboard_device_ref temporary
     WHERE temporary.organization_id = p_organization_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM ui.dashboard_device_ref retained
            WHERE retained.organization_id = p_organization_id
              AND retained.dashboard_id = temporary.dashboard_id
              AND retained.role = temporary.role
              AND retained.device_id = p_retained_device_id
              AND retained.channel IS NOT DISTINCT FROM temporary.channel
       );

    UPDATE ui.dashboard_device_ref
       SET device_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id;

    DELETE FROM ui.report_template_device_ref temporary
     WHERE temporary.organization_id = p_organization_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM ui.report_template_device_ref retained
            WHERE retained.organization_id = p_organization_id
              AND retained.template_id = temporary.template_id
              AND retained.selector = temporary.selector
              AND retained.device_id = p_retained_device_id
       );

    UPDATE ui.report_template_device_ref
       SET device_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id;
END;
$$;

--------------DOWN
UPDATE organization.report_templates t
   SET params = ui.fn_report_template_params_public(t.id, t.params);

DROP FUNCTION IF EXISTS ui.fn_reassign_device_ownership(VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS ui.fn_report_template_params_public(UUID, JSONB);
DROP FUNCTION IF EXISTS ui.fn_report_template_device_refs_replace(VARCHAR, UUID, JSONB);
DROP TABLE IF EXISTS ui.report_template_device_ref;
DROP TABLE IF EXISTS ui.report_template_device_selector;
DROP INDEX IF EXISTS organization.report_templates_organization_id_id_unique;
