--------------UP
-- Phase 5 hardening: notifications.add_token now requires a user_id so
-- tokens are bound to the caller's identity at insert time. The
-- (token, user_id) unique constraint from migration 2001 means an
-- upsert only refreshes the row when both match — a re-registration
-- from a different user inserts its own row instead of silently
-- hijacking an existing token.
--
-- DROP the old signature first; CREATE OR REPLACE does not work when
-- the argument list changes.
DROP FUNCTION IF EXISTS notifications.add_token(TEXT);

CREATE OR REPLACE FUNCTION notifications.add_token(
    p_token    TEXT,
    p_user_id  TEXT
)
RETURNS TABLE (
    id       BIGINT,
    token    TEXT,
    user_id  TEXT,
    created  TIMESTAMPTZ,
    updated  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH upsert AS (
        INSERT INTO notifications.tokens AS t (token, user_id, updated)
        VALUES (p_token, p_user_id, CURRENT_TIMESTAMP)
        ON CONFLICT ON CONSTRAINT tokens_token_user_key
        DO UPDATE SET updated = CURRENT_TIMESTAMP
        RETURNING t.id, t.token, t.user_id, t.created, t.updated
    )
    SELECT upsert.id, upsert.token, upsert.user_id, upsert.created, upsert.updated
      FROM upsert;
END;
$$;
--------------DOWN
-- DOWN order: operators run 6001 DOWN then 2001 DOWN. The recreated
-- add_token(p_token) must therefore reference the constraint that
-- 2001 DOWN restores, not the one 2001 replaced. `tokens_token_key`
-- is the auto-named UNIQUE from 2000_tokens.sql — post-full-downgrade
-- the function works; during the brief window between the two DOWN
-- steps, the function is defined but its CONFLICT target does not
-- exist yet (transient migration state, no callers mid-migration).
DROP FUNCTION IF EXISTS notifications.add_token(TEXT, TEXT);

CREATE OR REPLACE FUNCTION notifications.add_token(
    p_token TEXT
)
RETURNS TABLE (
    id       BIGINT,
    token    TEXT,
    created  TIMESTAMPTZ,
    updated  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH upsert AS (
        INSERT INTO notifications.tokens AS t (token, updated)
        VALUES (p_token, CURRENT_TIMESTAMP)
        ON CONFLICT ON CONSTRAINT tokens_token_key
        DO UPDATE SET updated = CURRENT_TIMESTAMP
        RETURNING t.id, t.token, t.created, t.updated
    )
    SELECT upsert.id, upsert.token, upsert.created, upsert.updated
      FROM upsert;
END;
$$;
