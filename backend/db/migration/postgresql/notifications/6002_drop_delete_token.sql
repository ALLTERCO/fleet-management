--------------UP
-- LINT-IGNORE: additive-only (deliberate legacy function removal)
-- Phase 7 cleanup: drop the orphan `notifications.delete_token`.
--
-- Verified zero callers across `backend/src` — NotificationComponent
-- never exposed a delete endpoint, and no other DB function
-- references it. Legacy behavior also deleted ALL rows matching a
-- token (regardless of owner) which is incorrect under the Phase 5
-- `(token, user_id)` unique constraint — if a future delete endpoint
-- lands it must delete scoped to `(token, user_id)` instead.
--
-- DOWN recreates the original definition verbatim for rollback. Note
-- that the recreated function is un-scoped and would behave
-- incorrectly on the post-2001 schema; it exists for rollback
-- completeness, not for ongoing use.
DROP FUNCTION IF EXISTS notifications.delete_token(TEXT);
--------------DOWN
CREATE OR REPLACE FUNCTION notifications.delete_token(
    p_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM notifications.tokens WHERE token = p_token;
END;
$$;
