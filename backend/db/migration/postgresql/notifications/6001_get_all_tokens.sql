--------------UP
-- Phase 5 hardening: extend get_all_tokens output to surface the
-- user_id column added in 2001_tokens_user_id.sql so the admin-only
-- Notification.ListTokens endpoint can show who each token belongs to.
--
-- DROP first; CREATE OR REPLACE does not work when the RETURNS TABLE
-- signature changes (4 columns → 5).
DROP FUNCTION IF EXISTS notifications.get_all_tokens();

CREATE OR REPLACE FUNCTION notifications.get_all_tokens()
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
    SELECT t.id, t.token, t.user_id, t.created, t.updated
      FROM notifications.tokens AS t
     ORDER BY t.created DESC;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.get_all_tokens();

CREATE OR REPLACE FUNCTION notifications.get_all_tokens()
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
    SELECT t.id, t.token, t.created, t.updated
      FROM notifications.tokens AS t
     ORDER BY t.created DESC;
END;
$$;
