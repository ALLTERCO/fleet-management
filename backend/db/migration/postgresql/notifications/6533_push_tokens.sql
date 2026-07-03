--------------UP
-- Mobile + web-push token registry. One row per (user, platform, token).

CREATE TABLE IF NOT EXISTS notifications.push_tokens (
    id              BIGSERIAL    PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    user_id         VARCHAR(255) NOT NULL,
    platform        VARCHAR(20)  NOT NULL CHECK (platform IN ('ios','android','webpush')),
    token           VARCHAR(500) NOT NULL,
    app_version     VARCHAR(40),
    env             VARCHAR(20)  NOT NULL DEFAULT 'prod' CHECK (env IN ('prod','sandbox')),
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    UNIQUE (platform, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_idx
    ON notifications.push_tokens (organization_id, user_id)
    WHERE revoked_at IS NULL;

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

CREATE OR REPLACE FUNCTION notifications.fn_push_token_revoke(
    p_organization_id VARCHAR,
    p_token           VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE notifications.push_tokens
           SET revoked_at = NOW()
         WHERE organization_id = p_organization_id
           AND token = p_token
           AND revoked_at IS NULL
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated);
$$;

CREATE OR REPLACE FUNCTION notifications.fn_push_token_list(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR
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
    SELECT id, organization_id, user_id, platform, token, app_version,
           env, registered_at, last_used_at, revoked_at
      FROM notifications.push_tokens
     WHERE organization_id = p_organization_id
       AND user_id = p_user_id
       AND revoked_at IS NULL
     ORDER BY registered_at DESC;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_push_token_list(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_push_token_revoke(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_push_token_register(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);
DROP TABLE IF EXISTS notifications.push_tokens;
