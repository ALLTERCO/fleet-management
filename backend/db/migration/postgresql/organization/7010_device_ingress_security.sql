--------------UP
-- Org-scoped ingress inventory for direct devices, connectors, waiting room,
-- rejection history, and provisioning sessions.

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS organization.device_ingress_identity (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    subject_type         text NOT NULL CHECK (
        subject_type IN ('device', 'connector', 'gateway', 'represented_device')
    ),
    subject_id           text NOT NULL,
    display_name         text NOT NULL,
    security_model       text NOT NULL CHECK (
        security_model IN ('certificate', 'direct_token', 'connector')
    ),
    transport            text NOT NULL CHECK (
        transport IN (
            'wss', 'ws', 'modbus_tcp', 'ble', 'cloud_api',
            'connector_internal'
        )
    ),
    risk_level           text NOT NULL CHECK (
        risk_level IN ('strong', 'compatible', 'legacy')
    ),
    CHECK (transport <> 'ws' OR risk_level = 'legacy'),
    CHECK (security_model <> 'certificate' OR transport <> 'ws'),
    status               text NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'active', 'disabled', 'quarantined', 'deleted')
    ),
    expected_external_id text,
    reported_external_ids text[] NOT NULL DEFAULT '{}'::text[],
    last_seen_at         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS device_ingress_identity_org_status_idx
    ON organization.device_ingress_identity (organization_id, status);

CREATE INDEX IF NOT EXISTS device_ingress_identity_expected_external_idx
    ON organization.device_ingress_identity (organization_id, expected_external_id)
    WHERE expected_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization.device_ingress_credential (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    identity_id             uuid NOT NULL
        REFERENCES organization.device_ingress_identity(id) ON DELETE CASCADE,
    credential_type         text NOT NULL CHECK (
        credential_type IN ('certificate', 'token')
    ),
    state                   text NOT NULL CHECK (
        state IN ('active', 'pending', 'expired', 'revoked', 'superseded')
    ),
    token_hash              text,
    token_prefix            text,
    certificate_id          uuid REFERENCES organization.certificates(id)
        ON DELETE SET NULL,
    certificate_fingerprint text,
    not_before              timestamptz,
    not_after               timestamptz,
    last_used_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (
            credential_type = 'token'
            AND token_hash IS NOT NULL
            AND certificate_id IS NULL
        )
        OR (
            credential_type = 'certificate'
            AND certificate_id IS NOT NULL
            AND token_hash IS NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS device_ingress_credential_identity_idx
    ON organization.device_ingress_credential (organization_id, identity_id, state);

CREATE INDEX IF NOT EXISTS device_ingress_credential_token_hash_idx
    ON organization.device_ingress_credential (token_hash)
    WHERE token_hash IS NOT NULL AND state IN ('active', 'pending');

CREATE INDEX IF NOT EXISTS device_ingress_credential_cert_fp_idx
    ON organization.device_ingress_credential (certificate_fingerprint)
    WHERE certificate_fingerprint IS NOT NULL
      AND state IN ('active', 'pending');

CREATE TABLE IF NOT EXISTS organization.device_ingress_connection (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    identity_id          uuid REFERENCES organization.device_ingress_identity(id)
        ON DELETE SET NULL,
    credential_id        uuid REFERENCES organization.device_ingress_credential(id)
        ON DELETE SET NULL,
    reported_external_id text,
    observed_transport   text NOT NULL,
    result               text NOT NULL CHECK (
        result IN ('accepted', 'waiting_room', 'rejected')
    ),
    reason_code          text,
    remote_address_hash  text,
    safe_detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
    user_agent           text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    disconnected_at      timestamptz,
    disconnect_reason    text
);

CREATE INDEX IF NOT EXISTS device_ingress_connection_org_created_idx
    ON organization.device_ingress_connection (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS device_ingress_connection_identity_idx
    ON organization.device_ingress_connection (identity_id, created_at DESC)
    WHERE identity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization.device_ingress_waiting_room (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    state                text NOT NULL DEFAULT 'open' CHECK (
        state IN ('open', 'approved', 'rejected', 'expired')
    ),
    reported_external_id text NOT NULL,
    observed_transport   text NOT NULL,
    security_model       text NOT NULL,
    risk_level           text NOT NULL,
    profile_id           text,
    safe_detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at        timestamptz NOT NULL DEFAULT now(),
    last_seen_at         timestamptz NOT NULL DEFAULT now(),
    attempt_count        integer NOT NULL DEFAULT 1,
    approved_identity_id uuid REFERENCES organization.device_ingress_identity(id)
        ON DELETE SET NULL,
    approved_at          timestamptz,
    rejected_at          timestamptz,
    rejection_reason     text
);

CREATE UNIQUE INDEX IF NOT EXISTS device_ingress_waiting_room_open_key
    ON organization.device_ingress_waiting_room (
        organization_id, reported_external_id, observed_transport
    )
    WHERE state = 'open';

CREATE INDEX IF NOT EXISTS device_ingress_waiting_room_org_state_idx
    ON organization.device_ingress_waiting_room (organization_id, state);

CREATE TABLE IF NOT EXISTS organization.device_ingress_rejection (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    identity_id          uuid REFERENCES organization.device_ingress_identity(id)
        ON DELETE SET NULL,
    credential_id        uuid REFERENCES organization.device_ingress_credential(id)
        ON DELETE SET NULL,
    waiting_room_id      uuid REFERENCES organization.device_ingress_waiting_room(id)
        ON DELETE SET NULL,
    reason_code          text NOT NULL,
    severity             text NOT NULL CHECK (severity IN ('fixable', 'blocked')),
    reported_external_id text,
    observed_transport   text,
    safe_detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    resolved_at          timestamptz,
    resolved_by          text,
    resolution_note      text
);

CREATE INDEX IF NOT EXISTS device_ingress_rejection_org_created_idx
    ON organization.device_ingress_rejection (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS device_ingress_rejection_reason_idx
    ON organization.device_ingress_rejection (organization_id, reason_code);

CREATE TABLE IF NOT EXISTS organization.device_ingress_setup_session (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    reported_external_id text NOT NULL,
    profile_id           text NOT NULL,
    status               text NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'applied', 'partial', 'failed', 'expired')
    ),
    apply_method         text,
    bundle               jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code           text,
    error_message        text,
    expires_at           timestamptz NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_ingress_setup_org_status_idx
    ON organization.device_ingress_setup_session (organization_id, status);

--------------DOWN
SET search_path TO organization;

DROP TABLE IF EXISTS organization.device_ingress_setup_session;
DROP TABLE IF EXISTS organization.device_ingress_rejection;
DROP TABLE IF EXISTS organization.device_ingress_waiting_room;
DROP TABLE IF EXISTS organization.device_ingress_connection;
DROP TABLE IF EXISTS organization.device_ingress_credential;
DROP TABLE IF EXISTS organization.device_ingress_identity;
