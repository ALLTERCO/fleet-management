--------------UP
-- Insert, consume (single-use, TTL-enforced), and prune for oauth_states.

CREATE OR REPLACE FUNCTION notifications.fn_oauth_state_insert(
    p_state_token     CHAR,
    p_organization_id VARCHAR,
    p_endpoint_id     INTEGER,
    p_provider        VARCHAR,
    p_client_id       VARCHAR,
    p_tenant          VARCHAR,
    p_code_verifier   VARCHAR,
    p_redirect_uri    VARCHAR,
    p_scopes          TEXT,
    p_ttl_seconds     INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    INSERT INTO notifications.oauth_states (
        state_token, organization_id, endpoint_id, provider, client_id,
        tenant, code_verifier, redirect_uri, scopes, expires_at
    )
    VALUES (
        p_state_token, p_organization_id, p_endpoint_id, p_provider,
        p_client_id, p_tenant, p_code_verifier, p_redirect_uri, p_scopes,
        NOW() + make_interval(secs => GREATEST(p_ttl_seconds, 60))
    );
END;
$$;

-- Atomic consume: returns the row ONLY if it exists, is not expired, and
-- has not been consumed. Marks consumed_at to prevent replay.
CREATE OR REPLACE FUNCTION notifications.fn_oauth_state_consume(
    p_state_token CHAR
)
RETURNS TABLE (
    organization_id VARCHAR,
    endpoint_id     INTEGER,
    provider        VARCHAR,
    client_id       VARCHAR,
    tenant          VARCHAR,
    code_verifier   VARCHAR,
    redirect_uri    VARCHAR,
    scopes          TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE notifications.oauth_states s
    SET consumed_at = NOW()
    WHERE s.state_token = p_state_token
      AND s.consumed_at IS NULL
      AND s.expires_at > NOW()
    RETURNING
        s.organization_id, s.endpoint_id, s.provider, s.client_id,
        s.tenant, s.code_verifier, s.redirect_uri, s.scopes;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_oauth_state_prune()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_pruned INTEGER;
BEGIN
    DELETE FROM notifications.oauth_states
    WHERE expires_at <= NOW()
       OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '1 hour');
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
    RETURN v_pruned;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_oauth_state_prune();
DROP FUNCTION IF EXISTS notifications.fn_oauth_state_consume(CHAR);
DROP FUNCTION IF EXISTS notifications.fn_oauth_state_insert(
    CHAR, VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, INTEGER
);
