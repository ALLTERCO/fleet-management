--------------UP
-- Scoped, single-use bearer tokens issued by Auth.MintScopedToken.
-- Only the SHA-256 hash of the token is stored; the plaintext is
-- returned once by the mint RPC and never persisted.

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS organization.scoped_token (
    token_hash       TEXT PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    issued_by        VARCHAR(120) NOT NULL,
    purpose          TEXT NOT NULL,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ,
    consumed_by      VARCHAR(120)
);

CREATE INDEX IF NOT EXISTS scoped_token_expires
    ON organization.scoped_token (expires_at)
    WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION organization.fn_scoped_token_record(
    p_token_hash      TEXT,
    p_organization_id VARCHAR,
    p_issued_by       VARCHAR,
    p_purpose         TEXT,
    p_ttl_seconds     INTEGER
)
RETURNS organization.scoped_token
LANGUAGE plpgsql
AS $$
DECLARE
    r organization.scoped_token;
BEGIN
    INSERT INTO organization.scoped_token (
        token_hash, organization_id, issued_by, purpose, expires_at
    ) VALUES (
        p_token_hash, p_organization_id, p_issued_by, p_purpose,
        now() + (p_ttl_seconds || ' seconds')::interval
    )
    RETURNING * INTO r;
    RETURN r;
END;
$$;

-- Atomically consume: enforce single-use + TTL + purpose match.
-- Returns the row when valid + freshly-consumed, no rows otherwise.
CREATE OR REPLACE FUNCTION organization.fn_scoped_token_consume(
    p_token_hash TEXT,
    p_purpose    TEXT,
    p_actor      VARCHAR
)
RETURNS organization.scoped_token
LANGUAGE plpgsql
AS $$
DECLARE
    r organization.scoped_token;
BEGIN
    UPDATE organization.scoped_token
       SET consumed_at = now(),
           consumed_by = p_actor
     WHERE token_hash = p_token_hash
       AND consumed_at IS NULL
       AND expires_at > now()
       AND purpose = p_purpose
    RETURNING * INTO r;
    RETURN r;
END;
$$;

--------------DOWN
SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_scoped_token_consume(TEXT, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_scoped_token_record(TEXT, VARCHAR, VARCHAR, TEXT, INTEGER);
DROP INDEX IF EXISTS organization.scoped_token_expires;
DROP TABLE IF EXISTS organization.scoped_token;
