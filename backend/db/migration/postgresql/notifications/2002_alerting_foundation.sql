--------------UP
-- Phase 0 foundation for alerts, inbox, destinations, integrations, and
-- delivery history. Runtime behavior is layered on top in later slices.
--
-- Enum value lists below are coupled with these TS source-of-truth files:
--   kind     → ALERT_RULE_KINDS    (backend/src/types/api/alert.ts)
--   severity → ALERT_SEVERITIES    (backend/src/types/api/alert.ts)
--   state    → ALERT_STATES        (backend/src/types/api/alert.ts)

CREATE TABLE notifications.alert_rules (
    id                 SERIAL       PRIMARY KEY,
    organization_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name               VARCHAR(120) NOT NULL,
    kind               VARCHAR(64)  NOT NULL,
    enabled            BOOLEAN      NOT NULL DEFAULT TRUE,
    severity           VARCHAR(16)  NOT NULL,
    scope              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    dedupe_window_sec  INTEGER      NOT NULL DEFAULT 0,
    cooldown_sec       INTEGER      NOT NULL DEFAULT 0,
    owner_user_id      VARCHAR(255),
    summary_template   TEXT,
    message_template   TEXT,
    auto_resolve       BOOLEAN      NOT NULL DEFAULT TRUE,
    config             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ,
    CONSTRAINT alert_rules_kind_valid CHECK (kind IN (
        'device_offline',
        'device_back_online',
        'battery_below',
        'smoke_alarm',
        'flood_alarm',
        'motion_detected',
        'entity_threshold',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed'
    )),
    CONSTRAINT alert_rules_severity_valid CHECK (severity IN (
        'info','warning','critical'
    )),
    CONSTRAINT alert_rules_dedupe_window_non_negative CHECK (dedupe_window_sec >= 0),
    CONSTRAINT alert_rules_cooldown_non_negative CHECK (cooldown_sec >= 0)
);

CREATE UNIQUE INDEX alert_rules_name_by_org
    ON notifications.alert_rules (organization_id, LOWER(name));
CREATE INDEX alert_rules_by_org_kind
    ON notifications.alert_rules (organization_id, kind, enabled);

CREATE TABLE notifications.alert_rule_destination_groups (
    rule_id                INTEGER      NOT NULL REFERENCES notifications.alert_rules(id) ON DELETE CASCADE,
    destination_group_id   INTEGER      NOT NULL,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT alert_rule_destination_groups_pk PRIMARY KEY (rule_id, destination_group_id)
);

CREATE TABLE notifications.alert_instances (
    id                            SERIAL       PRIMARY KEY,
    organization_id               VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    rule_id                       INTEGER      NOT NULL REFERENCES notifications.alert_rules(id) ON DELETE RESTRICT,
    rule_kind                     VARCHAR(64)  NOT NULL,
    state                         VARCHAR(24)  NOT NULL DEFAULT 'active',
    severity                      VARCHAR(16)  NOT NULL,
    source_subject_type           VARCHAR(24)  NOT NULL,
    source_subject_id             VARCHAR(255) NOT NULL,
    title                         VARCHAR(255) NOT NULL,
    message                       TEXT         NOT NULL,
    fingerprint                   VARCHAR(255) NOT NULL,
    active_since                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_triggered_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR(255),
    acknowledged_by_display_name  VARCHAR(255),
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER      NOT NULL DEFAULT 0,
    delivery_jobs_created_count   INTEGER      NOT NULL DEFAULT 0,
    context                       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT alert_instances_rule_kind_valid CHECK (rule_kind IN (
        'device_offline',
        'device_back_online',
        'battery_below',
        'smoke_alarm',
        'flood_alarm',
        'motion_detected',
        'entity_threshold',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed'
    )),
    CONSTRAINT alert_instances_state_valid CHECK (state IN (
        'active','acknowledged','resolved'
    )),
    CONSTRAINT alert_instances_severity_valid CHECK (severity IN (
        'info','warning','critical'
    )),
    CONSTRAINT alert_instances_subject_type_valid CHECK (source_subject_type IN (
        'device','entity','group','location','tag'
    ))
);

CREATE UNIQUE INDEX alert_instances_rule_fingerprint_active
    ON notifications.alert_instances (rule_id, fingerprint)
    WHERE resolved_at IS NULL;
CREATE INDEX alert_instances_by_org_state
    ON notifications.alert_instances (organization_id, state, severity);
CREATE INDEX alert_instances_by_source
    ON notifications.alert_instances (organization_id, source_subject_type, source_subject_id);

CREATE TABLE notifications.alert_transitions (
    id                  SERIAL       PRIMARY KEY,
    alert_id            INTEGER      NOT NULL REFERENCES notifications.alert_instances(id) ON DELETE CASCADE,
    action              VARCHAR(24)  NOT NULL,
    actor_user_id       VARCHAR(255),
    actor_display_name  VARCHAR(255),
    data                JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT alert_transitions_action_valid CHECK (action IN (
        'created',
        'triggered',
        'acknowledged',
        'unacknowledged',
        'silenced',
        'unsilenced',
        'resolved'
    ))
);

CREATE INDEX alert_transitions_by_alert
    ON notifications.alert_transitions (alert_id, created_at DESC);

CREATE TABLE notifications.inbox_items (
    id                 SERIAL       PRIMARY KEY,
    organization_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    user_id            VARCHAR(255) NOT NULL,
    kind               VARCHAR(32)  NOT NULL,
    state              VARCHAR(16)  NOT NULL DEFAULT 'unread',
    alert_id           INTEGER      REFERENCES notifications.alert_instances(id) ON DELETE SET NULL,
    source_subject_type VARCHAR(24),
    source_subject_id  VARCHAR(255),
    title              VARCHAR(255) NOT NULL,
    message            TEXT         NOT NULL,
    available_actions  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    read_at            TIMESTAMPTZ,
    CONSTRAINT inbox_items_kind_valid CHECK (kind IN (
        'alert_created','alert_updated','alert_resolved'
    )),
    CONSTRAINT inbox_items_state_valid CHECK (state IN ('unread','read')),
    CONSTRAINT inbox_items_subject_type_valid CHECK (
        source_subject_type IS NULL OR source_subject_type IN (
            'device','entity','group','location','tag'
        )
    )
);

CREATE INDEX inbox_items_by_user
    ON notifications.inbox_items (organization_id, user_id, state, created_at DESC);
CREATE INDEX inbox_items_by_alert
    ON notifications.inbox_items (alert_id);

CREATE TABLE notifications.destination_groups (
    id                 SERIAL       PRIMARY KEY,
    organization_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name               VARCHAR(120) NOT NULL,
    description        VARCHAR(500),
    enabled            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX destination_groups_name_by_org
    ON notifications.destination_groups (organization_id, LOWER(name));

CREATE TABLE notifications.destination_group_members (
    destination_group_id INTEGER      NOT NULL REFERENCES notifications.destination_groups(id) ON DELETE CASCADE,
    member_type          VARCHAR(32)  NOT NULL,
    member_id            VARCHAR(255) NOT NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT destination_group_members_pk PRIMARY KEY (destination_group_id, member_type, member_id),
    CONSTRAINT destination_group_members_type_valid CHECK (member_type IN (
        'user','integration_endpoint','push_token'
    ))
);

CREATE INDEX destination_group_members_by_member
    ON notifications.destination_group_members (member_type, member_id);

CREATE TABLE notifications.integration_endpoints (
    id                     SERIAL       PRIMARY KEY,
    organization_id        VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    provider               VARCHAR(64)  NOT NULL,
    name                   VARCHAR(120) NOT NULL,
    enabled                BOOLEAN      NOT NULL DEFAULT TRUE,
    config                 JSONB        NOT NULL DEFAULT '{}'::jsonb,
    last_test_at           TIMESTAMPTZ,
    last_test_status       VARCHAR(16),
    last_delivery_at       TIMESTAMPTZ,
    last_delivery_status   VARCHAR(16),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ,
    CONSTRAINT integration_endpoints_provider_valid CHECK (provider IN (
        'email_smtp',
        'generic_webhook',
        'slack_webhook',
        'teams_workflow_webhook',
        'telegram_bot'
    )),
    CONSTRAINT integration_endpoints_last_test_status_valid CHECK (
        last_test_status IS NULL OR last_test_status IN ('success','failed')
    ),
    CONSTRAINT integration_endpoints_last_delivery_status_valid CHECK (
        last_delivery_status IS NULL OR last_delivery_status IN ('success','failed')
    )
);

CREATE UNIQUE INDEX integration_endpoints_name_by_org
    ON notifications.integration_endpoints (organization_id, LOWER(name));
CREATE INDEX integration_endpoints_by_org_provider
    ON notifications.integration_endpoints (organization_id, provider, enabled);

CREATE TABLE notifications.integration_endpoint_secrets (
    endpoint_id         INTEGER      PRIMARY KEY REFERENCES notifications.integration_endpoints(id) ON DELETE CASCADE,
    encrypted_payload   TEXT         NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications.delivery_jobs (
    id                 SERIAL       PRIMARY KEY,
    organization_id    VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    alert_id           INTEGER      REFERENCES notifications.alert_instances(id) ON DELETE SET NULL,
    inbox_item_id      INTEGER      REFERENCES notifications.inbox_items(id) ON DELETE SET NULL,
    endpoint_id        INTEGER      NOT NULL REFERENCES notifications.integration_endpoints(id) ON DELETE RESTRICT,
    state              VARCHAR(16)  NOT NULL DEFAULT 'queued',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ,
    attempt_count      INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT delivery_jobs_state_valid CHECK (state IN (
        'queued','processing','succeeded','failed'
    )),
    CONSTRAINT delivery_jobs_attempt_count_non_negative CHECK (attempt_count >= 0)
);

CREATE INDEX delivery_jobs_by_org_state
    ON notifications.delivery_jobs (organization_id, state, created_at DESC);
CREATE INDEX delivery_jobs_by_endpoint
    ON notifications.delivery_jobs (endpoint_id, created_at DESC);

CREATE TABLE notifications.delivery_attempts (
    id               SERIAL       PRIMARY KEY,
    job_id           INTEGER      NOT NULL REFERENCES notifications.delivery_jobs(id) ON DELETE CASCADE,
    endpoint_id      INTEGER      NOT NULL REFERENCES notifications.integration_endpoints(id) ON DELETE RESTRICT,
    state            VARCHAR(16)  NOT NULL,
    attempted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    http_status      INTEGER,
    provider_code    VARCHAR(120),
    error_message    TEXT,
    CONSTRAINT delivery_attempts_state_valid CHECK (state IN ('succeeded','failed'))
);

CREATE INDEX delivery_attempts_by_job
    ON notifications.delivery_attempts (job_id, attempted_at DESC);
--------------DOWN
DROP TABLE IF EXISTS notifications.delivery_attempts;
DROP TABLE IF EXISTS notifications.delivery_jobs;
DROP TABLE IF EXISTS notifications.integration_endpoint_secrets;
DROP TABLE IF EXISTS notifications.integration_endpoints;
DROP TABLE IF EXISTS notifications.destination_group_members;
DROP TABLE IF EXISTS notifications.destination_groups;
DROP TABLE IF EXISTS notifications.inbox_items;
DROP TABLE IF EXISTS notifications.alert_transitions;
DROP TABLE IF EXISTS notifications.alert_instances;
DROP TABLE IF EXISTS notifications.alert_rule_destination_groups;
DROP TABLE IF EXISTS notifications.alert_rules;
