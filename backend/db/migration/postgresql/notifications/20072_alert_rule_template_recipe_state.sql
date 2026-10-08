--------------UP
ALTER TABLE notifications.alert_rule_templates
    ADD COLUMN IF NOT EXISTS active_window JSONB,
    ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;

ALTER TABLE notifications.alert_rule_templates
    ALTER COLUMN kind DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'alert_rule_templates_recipe_state_valid'
           AND conrelid = 'notifications.alert_rule_templates'::regclass
    ) THEN
        ALTER TABLE notifications.alert_rule_templates
            ADD CONSTRAINT alert_rule_templates_recipe_state_valid CHECK (
                (
                    available
                    AND kind IS NOT NULL
                    AND unavailable_reason IS NULL
                )
                OR
                (
                    NOT available
                    AND NULLIF(BTRIM(unavailable_reason), '') IS NOT NULL
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'alert_rule_templates_org_kind_required'
           AND conrelid = 'notifications.alert_rule_templates'::regclass
    ) THEN
        ALTER TABLE notifications.alert_rule_templates
            ADD CONSTRAINT alert_rule_templates_org_kind_required CHECK (
                organization_id IS NULL OR kind IS NOT NULL
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'alert_rule_templates_active_window_object'
           AND conrelid = 'notifications.alert_rule_templates'::regclass
    ) THEN
        ALTER TABLE notifications.alert_rule_templates
            ADD CONSTRAINT alert_rule_templates_active_window_object CHECK (
                active_window IS NULL OR jsonb_typeof(active_window) = 'object'
            );
    END IF;
END $$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB,
    JSONB, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, VARCHAR
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB,
    JSONB, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, VARCHAR, JSONB, BOOLEAN, TEXT
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_create(
    p_organization_id   VARCHAR,
    p_template_key      VARCHAR,
    p_category          VARCHAR,
    p_label             VARCHAR,
    p_description       TEXT,
    p_kind              VARCHAR,
    p_severity          VARCHAR,
    p_scope             JSONB,
    p_config            JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec      INTEGER,
    p_summary_template  TEXT,
    p_message_template  TEXT,
    p_auto_resolve      BOOLEAN,
    p_author_user_id    VARCHAR,
    p_active_window     JSONB DEFAULT NULL,
    p_available         BOOLEAN DEFAULT TRUE,
    p_unavailable_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, template_key VARCHAR,
    category VARCHAR, label VARCHAR, description TEXT, kind VARCHAR,
    severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    author_user_id VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    active_window JSONB, available BOOLEAN, unavailable_reason TEXT
)
LANGUAGE sql AS $$
    INSERT INTO notifications.alert_rule_templates (
        organization_id, template_key, category, label, description,
        kind, severity, scope, config, dedupe_window_sec, cooldown_sec,
        summary_template, message_template, auto_resolve, author_user_id,
        active_window, available, unavailable_reason
    ) VALUES (
        p_organization_id, p_template_key, p_category, p_label, p_description,
        p_kind, p_severity, COALESCE(p_scope, '{}'::jsonb),
        COALESCE(p_config, '{}'::jsonb),
        COALESCE(p_dedupe_window_sec, 0), COALESCE(p_cooldown_sec, 0),
        p_summary_template, p_message_template,
        COALESCE(p_auto_resolve, TRUE), p_author_user_id,
        p_active_window, COALESCE(p_available, TRUE), p_unavailable_reason
    )
    RETURNING
        alert_rule_templates.id,
        alert_rule_templates.organization_id,
        alert_rule_templates.template_key,
        alert_rule_templates.category,
        alert_rule_templates.label,
        alert_rule_templates.description,
        alert_rule_templates.kind,
        alert_rule_templates.severity,
        alert_rule_templates.scope,
        alert_rule_templates.config,
        alert_rule_templates.dedupe_window_sec,
        alert_rule_templates.cooldown_sec,
        alert_rule_templates.summary_template,
        alert_rule_templates.message_template,
        alert_rule_templates.auto_resolve,
        alert_rule_templates.author_user_id,
        alert_rule_templates.created_at,
        alert_rule_templates.updated_at,
        alert_rule_templates.active_window,
        alert_rule_templates.available,
        alert_rule_templates.unavailable_reason;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, JSONB,
    INTEGER, INTEGER, TEXT, TEXT, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, JSONB,
    INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, JSONB, BOOLEAN, BOOLEAN, TEXT, BOOLEAN
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_update(
    p_organization_id VARCHAR,
    p_id INTEGER,
    p_author_user_id VARCHAR,
    p_label VARCHAR,
    p_description TEXT,
    p_severity VARCHAR,
    p_scope JSONB,
    p_config JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec INTEGER,
    p_summary_template TEXT,
    p_message_template TEXT,
    p_auto_resolve BOOLEAN,
    p_active_window JSONB DEFAULT NULL,
    p_clear_active_window BOOLEAN DEFAULT FALSE,
    p_available BOOLEAN DEFAULT NULL,
    p_unavailable_reason TEXT DEFAULT NULL,
    p_clear_unavailable_reason BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, template_key VARCHAR,
    category VARCHAR, label VARCHAR, description TEXT, kind VARCHAR,
    severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    author_user_id VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    active_window JSONB, available BOOLEAN, unavailable_reason TEXT
)
LANGUAGE sql AS $$
    UPDATE notifications.alert_rule_templates t
       SET label = COALESCE(p_label, t.label),
           description = COALESCE(p_description, t.description),
           severity = COALESCE(p_severity, t.severity),
           scope = COALESCE(p_scope, t.scope),
           config = COALESCE(p_config, t.config),
           dedupe_window_sec = COALESCE(
               p_dedupe_window_sec, t.dedupe_window_sec
           ),
           cooldown_sec = COALESCE(p_cooldown_sec, t.cooldown_sec),
           summary_template = COALESCE(
               p_summary_template, t.summary_template
           ),
           message_template = COALESCE(
               p_message_template, t.message_template
           ),
           auto_resolve = COALESCE(p_auto_resolve, t.auto_resolve),
           active_window = CASE
               WHEN p_clear_active_window THEN NULL
               WHEN p_active_window IS NOT NULL THEN p_active_window
               ELSE t.active_window
           END,
           available = COALESCE(p_available, t.available),
           unavailable_reason = CASE
               WHEN p_clear_unavailable_reason THEN NULL
               WHEN p_unavailable_reason IS NOT NULL THEN p_unavailable_reason
               ELSE t.unavailable_reason
           END,
           updated_at = NOW()
     WHERE t.id = p_id
       AND t.organization_id = p_organization_id
       AND t.author_user_id = p_author_user_id
    RETURNING
        t.id, t.organization_id, t.template_key, t.category, t.label,
        t.description, t.kind, t.severity, t.scope, t.config,
        t.dedupe_window_sec, t.cooldown_sec, t.summary_template,
        t.message_template, t.auto_resolve, t.author_user_id, t.created_at,
        t.updated_at, t.active_window, t.available, t.unavailable_reason;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_list(VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_list(
    p_organization_id VARCHAR,
    p_category VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    template_key VARCHAR, category VARCHAR, label VARCHAR, description TEXT,
    kind VARCHAR, severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    id INTEGER, organization_id VARCHAR, author_user_id VARCHAR,
    active_window JSONB, available BOOLEAN, unavailable_reason TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT t.template_key, t.category, t.label, t.description, t.kind,
           t.severity,
           notifications.fn_alert_rule_template_scope_public(t.id, t.scope),
           t.config, t.dedupe_window_sec, t.cooldown_sec,
           t.summary_template, t.message_template, t.auto_resolve,
           t.id, t.organization_id, t.author_user_id, t.active_window,
           t.available, t.unavailable_reason
      FROM notifications.alert_rule_templates t
     WHERE (p_category IS NULL OR t.category = p_category)
       AND (t.organization_id = p_organization_id OR t.organization_id IS NULL)
     ORDER BY t.category, t.template_key;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_get(VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_get(
    p_template_key VARCHAR,
    p_organization_id VARCHAR
)
RETURNS TABLE (
    template_key VARCHAR, category VARCHAR, label VARCHAR, description TEXT,
    kind VARCHAR, severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    id INTEGER, organization_id VARCHAR, author_user_id VARCHAR,
    active_window JSONB, available BOOLEAN, unavailable_reason TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT t.template_key, t.category, t.label, t.description, t.kind,
           t.severity,
           notifications.fn_alert_rule_template_scope_public(t.id, t.scope),
           t.config, t.dedupe_window_sec, t.cooldown_sec,
           t.summary_template, t.message_template, t.auto_resolve,
           t.id, t.organization_id, t.author_user_id, t.active_window,
           t.available, t.unavailable_reason
      FROM notifications.alert_rule_templates t
     WHERE t.template_key = p_template_key
       AND (t.organization_id = p_organization_id OR t.organization_id IS NULL)
     ORDER BY (t.organization_id IS NOT NULL) DESC
     LIMIT 1;
$$;

INSERT INTO notifications.alert_rule_templates (
    template_key, category, label, description, kind, severity, scope, config,
    dedupe_window_sec, cooldown_sec, summary_template, message_template,
    auto_resolve, active_window, available, unavailable_reason
) VALUES
    (
        'oasis:leak', 'oasis', 'Water leak',
        'Shut the valve for that villa, then find the leak.',
        'flood_alarm', 'critical', '{}'::jsonb, '{}'::jsonb,
        0, 0, '{{alert.title}}',
        'Shut the valve for that villa, then find the leak.',
        TRUE, NULL, TRUE, NULL
    ),
    (
        'oasis:smoke', 'oasis', 'Smoke',
        'Treat as a fire until someone confirms otherwise.',
        'smoke_alarm', 'critical', '{}'::jsonb, '{}'::jsonb,
        0, 0, '{{alert.title}}',
        'Treat as a fire until someone confirms otherwise.',
        TRUE, NULL, TRUE, NULL
    ),
    (
        'oasis:device_offline', 'oasis', 'Device offline',
        'Check power and network at that villa.',
        'device_offline', 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, '{{alert.title}}', 'Check power and network at that villa.',
        TRUE, NULL, FALSE,
        'Fleet alert configuration does not expose this rule threshold to Oasis.'
    ),
    (
        'oasis:lights_out', 'oasis', 'Lights out',
        'Walk the run and find the failed lamps. The meter covers the whole run, not one lamp.',
        'component_threshold', 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, '{{alert.title}}',
        'Walk the run and find the failed lamps. The meter covers the whole run, not one lamp.',
        TRUE, NULL, FALSE,
        'Fleet alert configuration does not expose the lighting threshold to Oasis.'
    ),
    (
        'oasis:tank_low', 'oasis', 'Tank low',
        'Refill the tank or check the supply valve.',
        'component_threshold', 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, '{{alert.title}}', 'Refill the tank or check the supply valve.',
        TRUE, NULL, FALSE,
        'Fleet alert configuration does not expose tank geometry to Oasis.'
    ),
    (
        'oasis:gate_open', 'oasis', 'Gate left open',
        'Send someone to close it.',
        'component_state', 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, '{{alert.title}}', 'Send someone to close it.',
        TRUE, NULL, FALSE,
        'Fleet alert configuration does not expose the gate threshold to Oasis.'
    ),
    (
        'oasis:price_step_near', 'oasis', 'Close to the next price step',
        'Fleet billing does not expose the next billed step as an alert threshold.',
        NULL, 'info', '{}'::jsonb, '{}'::jsonb,
        0, 0, NULL, NULL, TRUE, NULL, FALSE,
        'Fleet billing does not expose a current-step threshold rule.'
    ),
    (
        'oasis:zone_did_not_run', 'oasis', 'Watering zone did not run',
        'Check the valve and the controller schedule.',
        NULL, 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, NULL, NULL, TRUE, NULL, FALSE,
        'Fleet does not provide this irrigation threshold to Oasis.'
    ),
    (
        'oasis:solar_down', 'oasis', 'Solar under its neighbours',
        'Check the panels for dust, shading or a tripped inverter.',
        NULL, 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, NULL, NULL, TRUE, NULL, FALSE,
        'Fleet does not provide this comparison threshold to Oasis.'
    ),
    (
        'oasis:baseline_high', 'oasis', 'Overnight draw too high',
        'Find what is running at 3am in that villa.',
        NULL, 'warning', '{}'::jsonb, '{}'::jsonb,
        0, 0, NULL, NULL, TRUE, NULL, FALSE,
        'Fleet does not provide an overnight baseline threshold to Oasis.'
    )
ON CONFLICT (COALESCE(organization_id, ''), template_key) DO UPDATE
SET category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    kind = EXCLUDED.kind,
    severity = EXCLUDED.severity,
    scope = EXCLUDED.scope,
    config = EXCLUDED.config,
    dedupe_window_sec = EXCLUDED.dedupe_window_sec,
    cooldown_sec = EXCLUDED.cooldown_sec,
    summary_template = EXCLUDED.summary_template,
    message_template = EXCLUDED.message_template,
    auto_resolve = EXCLUDED.auto_resolve,
    active_window = EXCLUDED.active_window,
    available = EXCLUDED.available,
    unavailable_reason = EXCLUDED.unavailable_reason
WHERE notifications.alert_rule_templates.organization_id IS NULL;

--------------DOWN
DELETE FROM notifications.alert_rule_templates
WHERE organization_id IS NULL
  AND template_key IN (
      'oasis:leak',
      'oasis:smoke',
      'oasis:device_offline',
      'oasis:lights_out',
      'oasis:tank_low',
      'oasis:gate_open',
      'oasis:price_step_near',
      'oasis:zone_did_not_run',
      'oasis:solar_down',
      'oasis:baseline_high'
  );

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB,
    JSONB, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, VARCHAR, JSONB, BOOLEAN, TEXT
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, JSONB,
    INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, JSONB, BOOLEAN, BOOLEAN, TEXT, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_list(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_get(VARCHAR, VARCHAR);

ALTER TABLE notifications.alert_rule_templates
    DROP CONSTRAINT IF EXISTS alert_rule_templates_active_window_object,
    DROP CONSTRAINT IF EXISTS alert_rule_templates_org_kind_required,
    DROP CONSTRAINT IF EXISTS alert_rule_templates_recipe_state_valid;

ALTER TABLE notifications.alert_rule_templates
    ALTER COLUMN kind SET NOT NULL;

ALTER TABLE notifications.alert_rule_templates
    DROP COLUMN IF EXISTS unavailable_reason,
    DROP COLUMN IF EXISTS available,
    DROP COLUMN IF EXISTS active_window;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_create(
    p_organization_id VARCHAR, p_template_key VARCHAR, p_category VARCHAR,
    p_label VARCHAR, p_description TEXT, p_kind VARCHAR, p_severity VARCHAR,
    p_scope JSONB, p_config JSONB, p_dedupe_window_sec INTEGER,
    p_cooldown_sec INTEGER, p_summary_template TEXT,
    p_message_template TEXT, p_auto_resolve BOOLEAN, p_author_user_id VARCHAR
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, template_key VARCHAR,
    category VARCHAR, label VARCHAR, description TEXT, kind VARCHAR,
    severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    author_user_id VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    INSERT INTO notifications.alert_rule_templates (
        organization_id, template_key, category, label, description,
        kind, severity, scope, config, dedupe_window_sec, cooldown_sec,
        summary_template, message_template, auto_resolve, author_user_id
    ) VALUES (
        p_organization_id, p_template_key, p_category, p_label, p_description,
        p_kind, p_severity, COALESCE(p_scope, '{}'::jsonb),
        COALESCE(p_config, '{}'::jsonb),
        COALESCE(p_dedupe_window_sec, 0), COALESCE(p_cooldown_sec, 0),
        p_summary_template, p_message_template,
        COALESCE(p_auto_resolve, TRUE), p_author_user_id
    )
    RETURNING
        alert_rule_templates.id,
        alert_rule_templates.organization_id,
        alert_rule_templates.template_key,
        alert_rule_templates.category,
        alert_rule_templates.label,
        alert_rule_templates.description,
        alert_rule_templates.kind,
        alert_rule_templates.severity,
        alert_rule_templates.scope,
        alert_rule_templates.config,
        alert_rule_templates.dedupe_window_sec,
        alert_rule_templates.cooldown_sec,
        alert_rule_templates.summary_template,
        alert_rule_templates.message_template,
        alert_rule_templates.auto_resolve,
        alert_rule_templates.author_user_id,
        alert_rule_templates.created_at,
        alert_rule_templates.updated_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_update(
    p_organization_id VARCHAR, p_id INTEGER, p_author_user_id VARCHAR,
    p_label VARCHAR, p_description TEXT, p_severity VARCHAR, p_scope JSONB,
    p_config JSONB, p_dedupe_window_sec INTEGER, p_cooldown_sec INTEGER,
    p_summary_template TEXT, p_message_template TEXT, p_auto_resolve BOOLEAN
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, template_key VARCHAR,
    category VARCHAR, label VARCHAR, description TEXT, kind VARCHAR,
    severity VARCHAR, scope JSONB, config JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    author_user_id VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    UPDATE notifications.alert_rule_templates t
       SET label = COALESCE(p_label, t.label),
           description = COALESCE(p_description, t.description),
           severity = COALESCE(p_severity, t.severity),
           scope = COALESCE(p_scope, t.scope),
           config = COALESCE(p_config, t.config),
           dedupe_window_sec = COALESCE(
               p_dedupe_window_sec, t.dedupe_window_sec
           ),
           cooldown_sec = COALESCE(p_cooldown_sec, t.cooldown_sec),
           summary_template = COALESCE(
               p_summary_template, t.summary_template
           ),
           message_template = COALESCE(
               p_message_template, t.message_template
           ),
           auto_resolve = COALESCE(p_auto_resolve, t.auto_resolve),
           updated_at = NOW()
     WHERE t.id = p_id
       AND t.organization_id = p_organization_id
       AND t.author_user_id = p_author_user_id
    RETURNING
        t.id, t.organization_id, t.template_key, t.category, t.label,
        t.description, t.kind, t.severity, t.scope, t.config,
        t.dedupe_window_sec, t.cooldown_sec, t.summary_template,
        t.message_template, t.auto_resolve, t.author_user_id, t.created_at,
        t.updated_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_list(
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

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_get(
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
