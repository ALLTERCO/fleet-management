--------------UP
-- Short-lived state tokens for in-app OAuth2 consent (Gmail / M365).
-- The Start RPC inserts; the callback route consumes single-use. Stale
-- rows are pruned by TTL, not by DELETE during consume.

CREATE TABLE notifications.oauth_states (
    state_token     CHAR(64)     PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    endpoint_id     INTEGER      REFERENCES notifications.integration_endpoints(id) ON DELETE CASCADE,
    provider        VARCHAR(40)  NOT NULL,
    client_id       VARCHAR(1024) NOT NULL,
    tenant          VARCHAR(120),
    code_verifier   VARCHAR(128) NOT NULL,
    redirect_uri    VARCHAR(2048) NOT NULL,
    scopes          TEXT         NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,

    CONSTRAINT oauth_states_state_token_hex   CHECK (state_token ~ '^[a-f0-9]{64}$'),
    CONSTRAINT oauth_states_provider_known    CHECK (provider IN ('oauth2_google', 'oauth2_microsoft')),
    CONSTRAINT oauth_states_expires_future    CHECK (expires_at > created_at)
);

CREATE INDEX oauth_states_by_expiry
    ON notifications.oauth_states (expires_at);

--------------DOWN
DROP INDEX IF EXISTS notifications.oauth_states_by_expiry;
DROP TABLE IF EXISTS notifications.oauth_states;
