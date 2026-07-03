--------------UP
-- FM-side metadata for service-user PATs. Zitadel PATs carry no name and the
-- token is never re-exposed after creation (verified against the v2 API), so
-- we store a human name + a masked hint (first/last few chars, never enough to
-- reconstruct) captured at mint time, keyed by the Zitadel token id.
SET search_path TO organization;

CREATE TABLE IF NOT EXISTS organization.service_user_token_meta (
    token_id         VARCHAR(120) PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    user_id          VARCHAR(120) NOT NULL,
    name             VARCHAR(120) NOT NULL DEFAULT '',
    key_hint         VARCHAR(40)  NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_user_token_meta_user
    ON organization.service_user_token_meta (organization_id, user_id);

-- Record (or upsert) the metadata for a freshly-minted token.
CREATE OR REPLACE FUNCTION organization.fn_service_user_token_meta_record(
    p_token_id        VARCHAR,
    p_organization_id VARCHAR,
    p_user_id         VARCHAR,
    p_name            VARCHAR,
    p_key_hint        VARCHAR
)
RETURNS organization.service_user_token_meta
LANGUAGE plpgsql
AS $$
DECLARE
    r organization.service_user_token_meta;
BEGIN
    INSERT INTO organization.service_user_token_meta (
        token_id, organization_id, user_id, name, key_hint
    ) VALUES (
        p_token_id, p_organization_id, p_user_id,
        COALESCE(p_name, ''), COALESCE(p_key_hint, '')
    )
    ON CONFLICT (token_id) DO UPDATE
        SET name = EXCLUDED.name,
            key_hint = EXCLUDED.key_hint
    RETURNING * INTO r;
    RETURN r;
END;
$$;

-- List metadata for one service user within a tenant.
CREATE OR REPLACE FUNCTION organization.fn_service_user_token_meta_list(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR
)
RETURNS SETOF organization.service_user_token_meta
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT *
      FROM organization.service_user_token_meta
     WHERE organization_id = p_organization_id
       AND user_id = p_user_id;
END;
$$;

-- Housekeeping: drop metadata when a token is revoked/deleted.
CREATE OR REPLACE FUNCTION organization.fn_service_user_token_meta_delete(
    p_token_id VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM organization.service_user_token_meta WHERE token_id = p_token_id;
END;
$$;

--------------DOWN
SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_service_user_token_meta_delete(VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_service_user_token_meta_list(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_service_user_token_meta_record(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP INDEX IF EXISTS organization.service_user_token_meta_user;
DROP TABLE IF EXISTS organization.service_user_token_meta;
