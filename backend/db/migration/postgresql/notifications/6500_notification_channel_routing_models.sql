--------------UP
-- Notification architecture v1 data model. Additive only: existing
-- destination groups and integration endpoints keep working during migration.

ALTER TABLE notifications.integration_endpoints
    ADD COLUMN IF NOT EXISTS endpoint_mode VARCHAR(32) NOT NULL DEFAULT 'custom_smtp';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'integration_endpoints_endpoint_mode_valid'
    ) THEN
        ALTER TABLE notifications.integration_endpoints
            ADD CONSTRAINT integration_endpoints_endpoint_mode_valid CHECK (
                endpoint_mode IN ('custom_smtp', 'use_system_smtp')
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications.system_email_config (
    organization_id        VARCHAR(120) PRIMARY KEY REFERENCES organization.profile(id) ON DELETE CASCADE,
    enabled                BOOLEAN      NOT NULL DEFAULT FALSE,
    from_address           VARCHAR(320),
    from_name              VARCHAR(128),
    verification_status    VARCHAR(24)  NOT NULL DEFAULT 'unverified',
    last_verified_at       TIMESTAMPTZ,
    last_failure_at        TIMESTAMPTZ,
    last_failure_message   TEXT,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ,
    CONSTRAINT system_email_config_status_valid CHECK (
        verification_status IN ('unverified', 'verified', 'failed')
    )
);

CREATE TABLE IF NOT EXISTS notifications.channels (
    id                      BIGSERIAL    PRIMARY KEY,
    organization_id         VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    integration_endpoint_id INTEGER      REFERENCES notifications.integration_endpoints(id) ON DELETE SET NULL,
    name                    VARCHAR(120) NOT NULL,
    type                    VARCHAR(64)  NOT NULL,
    config                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    secret_version          INTEGER      NOT NULL DEFAULT 0,
    verification_status     VARCHAR(24)  NOT NULL DEFAULT 'unverified',
    disabled_reason         VARCHAR(255),
    last_delivery_status    VARCHAR(16),
    last_delivery_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ,
    CONSTRAINT channels_type_valid CHECK (type IN (
        'email_smtp',
        'generic_webhook',
        'slack_webhook',
        'teams_workflow_webhook',
        'telegram_bot'
    )),
    CONSTRAINT channels_verification_status_valid CHECK (
        verification_status IN ('unverified', 'verified', 'failed')
    ),
    CONSTRAINT channels_last_delivery_status_valid CHECK (
        last_delivery_status IS NULL OR last_delivery_status IN ('success', 'failed')
    ),
    CONSTRAINT channels_secret_version_non_negative CHECK (secret_version >= 0),
    CONSTRAINT channels_config_object CHECK (jsonb_typeof(config) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS channels_name_by_org
    ON notifications.channels (organization_id, LOWER(name));
CREATE INDEX IF NOT EXISTS channels_by_org_type
    ON notifications.channels (organization_id, type);
CREATE INDEX IF NOT EXISTS channels_by_endpoint
    ON notifications.channels (integration_endpoint_id)
    WHERE integration_endpoint_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications.user_notification_preferences (
    organization_id     VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    user_id             VARCHAR(255) NOT NULL,
    channel_type        VARCHAR(64)  NOT NULL,
    severity_filters    JSONB        NOT NULL DEFAULT '["info","warning","critical"]'::jsonb,
    quiet_hours         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    digest_preference   JSONB        NOT NULL DEFAULT '{"mode":"immediate"}'::jsonb,
    disabled            BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    PRIMARY KEY (organization_id, user_id, channel_type),
    CONSTRAINT user_notification_preferences_channel_type_valid CHECK (
        channel_type IN (
            'email_smtp',
            'generic_webhook',
            'slack_webhook',
            'teams_workflow_webhook',
            'telegram_bot',
            'in_app'
        )
    ),
    CONSTRAINT user_notification_preferences_severities_array CHECK (
        jsonb_typeof(severity_filters) = 'array'
    ),
    CONSTRAINT user_notification_preferences_quiet_hours_object CHECK (
        jsonb_typeof(quiet_hours) = 'object'
    ),
    CONSTRAINT user_notification_preferences_digest_object CHECK (
        jsonb_typeof(digest_preference) = 'object'
    )
);

CREATE TABLE IF NOT EXISTS notifications.on_call_schedules (
    id               BIGSERIAL    PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name             VARCHAR(120) NOT NULL,
    timezone         VARCHAR(80)  NOT NULL DEFAULT 'UTC',
    rotation_rules   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    overrides        JSONB        NOT NULL DEFAULT '[]'::jsonb,
    target           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    enabled          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ,
    CONSTRAINT on_call_schedules_rotation_rules_array CHECK (
        jsonb_typeof(rotation_rules) = 'array'
    ),
    CONSTRAINT on_call_schedules_overrides_array CHECK (
        jsonb_typeof(overrides) = 'array'
    ),
    CONSTRAINT on_call_schedules_target_object CHECK (
        jsonb_typeof(target) = 'object'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS on_call_schedules_name_by_org
    ON notifications.on_call_schedules (organization_id, LOWER(name));

CREATE TABLE IF NOT EXISTS notifications.routing_policies (
    id                    BIGSERIAL    PRIMARY KEY,
    organization_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    parent_policy_id      BIGINT       REFERENCES notifications.routing_policies(id) ON DELETE CASCADE,
    name                  VARCHAR(120) NOT NULL,
    sort_order            INTEGER      NOT NULL DEFAULT 0,
    label_matchers        JSONB        NOT NULL DEFAULT '[]'::jsonb,
    severity_matchers     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    resource_selectors    JSONB        NOT NULL DEFAULT '[]'::jsonb,
    contact_points        JSONB        NOT NULL DEFAULT '[]'::jsonb,
    grouping_keys         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    mute_windows          JSONB        NOT NULL DEFAULT '[]'::jsonb,
    runtime_silences      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    inhibition_rules      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    escalation_stages     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ,
    CONSTRAINT routing_policies_sort_order_non_negative CHECK (sort_order >= 0),
    CONSTRAINT routing_policies_label_matchers_array CHECK (jsonb_typeof(label_matchers) = 'array'),
    CONSTRAINT routing_policies_severity_matchers_array CHECK (jsonb_typeof(severity_matchers) = 'array'),
    CONSTRAINT routing_policies_resource_selectors_array CHECK (jsonb_typeof(resource_selectors) = 'array'),
    CONSTRAINT routing_policies_contact_points_array CHECK (jsonb_typeof(contact_points) = 'array'),
    CONSTRAINT routing_policies_grouping_keys_array CHECK (jsonb_typeof(grouping_keys) = 'array'),
    CONSTRAINT routing_policies_mute_windows_array CHECK (jsonb_typeof(mute_windows) = 'array'),
    CONSTRAINT routing_policies_runtime_silences_array CHECK (jsonb_typeof(runtime_silences) = 'array'),
    CONSTRAINT routing_policies_inhibition_rules_array CHECK (jsonb_typeof(inhibition_rules) = 'array'),
    CONSTRAINT routing_policies_escalation_stages_array CHECK (jsonb_typeof(escalation_stages) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS routing_policies_name_by_org
    ON notifications.routing_policies (organization_id, LOWER(name));
CREATE INDEX IF NOT EXISTS routing_policies_by_parent_sort_order
    ON notifications.routing_policies (organization_id, parent_policy_id, sort_order);

--------------DOWN
DROP TABLE IF EXISTS notifications.routing_policies;
DROP TABLE IF EXISTS notifications.on_call_schedules;
DROP TABLE IF EXISTS notifications.user_notification_preferences;
DROP TABLE IF EXISTS notifications.channels;
DROP TABLE IF EXISTS notifications.system_email_config;
ALTER TABLE notifications.integration_endpoints
    DROP CONSTRAINT IF EXISTS integration_endpoints_endpoint_mode_valid,
    DROP COLUMN IF EXISTS endpoint_mode;
