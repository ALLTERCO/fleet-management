--------------UP
-- Bind push notification tokens to a specific user.
--
-- The Phase 5 audit flagged notifications.add_token as accepting any
-- anonymous write because the component handler was @NoPermissions and
-- the DB function did not carry a user identity. Adding a user_id
-- column and changing the unique constraint to (token, user_id) makes
-- the registration intent explicit:
--
--   * One push token can belong to multiple users (shared device).
--   * One user can register the token they own multiple times (idempotent).
--   * A re-registration from a DIFFERENT user does not silently hijack
--     an existing token — it inserts its own row.
--
-- Existing rows (if any) are backfilled with NULL user_id; those are
-- treated as legacy orphans that the Phase 5 handler will ignore at
-- the API layer (all new registrations require a username).
ALTER TABLE notifications.tokens
    ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE notifications.tokens
    DROP CONSTRAINT IF EXISTS tokens_token_key;

ALTER TABLE notifications.tokens
    ADD CONSTRAINT tokens_token_user_key UNIQUE (token, user_id);

CREATE INDEX IF NOT EXISTS tokens_user_id_idx
    ON notifications.tokens (user_id);
--------------DOWN
DROP INDEX IF EXISTS notifications.tokens_user_id_idx;
ALTER TABLE notifications.tokens
    DROP CONSTRAINT IF EXISTS tokens_token_user_key;
ALTER TABLE notifications.tokens
    ADD CONSTRAINT tokens_token_key UNIQUE (token);
ALTER TABLE notifications.tokens DROP COLUMN IF EXISTS user_id;
