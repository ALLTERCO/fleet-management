--------------UP
-- Stop silent cross-org push-token transfer. The ON CONFLICT blindly moved a
-- token's org + user to whoever re-registered it. Only refresh when the same
-- org owns the token; a foreign org's register no-ops (token keeps its owner,
-- and the empty result lets the caller surface it).
CREATE OR REPLACE FUNCTION notifications.fn_push_token_register(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR,
    p_platform        VARCHAR,
    p_token           VARCHAR,
    p_app_version     VARCHAR,
    p_env             VARCHAR
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    user_id         VARCHAR,
    platform        VARCHAR,
    token           VARCHAR,
    app_version     VARCHAR,
    env             VARCHAR,
    registered_at   TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.push_tokens
        (organization_id, user_id, platform, token, app_version, env)
    VALUES
        (p_organization_id, p_user_id, p_platform, p_token,
         p_app_version, COALESCE(p_env, 'prod'))
    ON CONFLICT (platform, token)
    DO UPDATE SET user_id       = EXCLUDED.user_id,
                  app_version   = EXCLUDED.app_version,
                  env           = EXCLUDED.env,
                  revoked_at    = NULL,
                  registered_at = NOW()
    WHERE notifications.push_tokens.organization_id = EXCLUDED.organization_id
    RETURNING
        id, organization_id, user_id, platform, token, app_version, env,
        registered_at, last_used_at, revoked_at;
$$;
--------------DOWN
CREATE OR REPLACE FUNCTION notifications.fn_push_token_register(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR,
    p_platform        VARCHAR,
    p_token           VARCHAR,
    p_app_version     VARCHAR,
    p_env             VARCHAR
)
RETURNS TABLE (
    id              BIGINT,
    organization_id VARCHAR,
    user_id         VARCHAR,
    platform        VARCHAR,
    token           VARCHAR,
    app_version     VARCHAR,
    env             VARCHAR,
    registered_at   TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.push_tokens
        (organization_id, user_id, platform, token, app_version, env)
    VALUES
        (p_organization_id, p_user_id, p_platform, p_token,
         p_app_version, COALESCE(p_env, 'prod'))
    ON CONFLICT (platform, token)
    DO UPDATE SET organization_id = EXCLUDED.organization_id,
                  user_id         = EXCLUDED.user_id,
                  app_version     = EXCLUDED.app_version,
                  env             = EXCLUDED.env,
                  revoked_at      = NULL,
                  registered_at   = NOW()
    RETURNING
        id, organization_id, user_id, platform, token, app_version, env,
        registered_at, last_used_at, revoked_at;
$$;
