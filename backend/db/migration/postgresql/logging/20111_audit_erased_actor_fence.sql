--------------UP
-- User erasure anonymized only the audit rows already stored. A row still in
-- the in-memory queue or the Redis overflow stream was inserted afterwards
-- with the erased person's username. Erasure now fences the actor, and every
-- insert into audit_log (fn_audit_log_add, fn_audit_log_add_batch) anonymizes
-- a fenced actor's row with the values the erasure uses: '<deleted-user>' and
-- no actor_user_id.
--
-- Ordering: erasure takes the fence lock exclusively before it anonymizes
-- stored rows; every insert takes it shared before it reads the fence. An
-- insert that started first commits before the erasure reads audit_log; one
-- that starts later waits and then sees the committed fence.
--
-- Digests, not identities: the fence must not retain what erasure removed.
CREATE TABLE IF NOT EXISTS logging.erased_audit_actor (
    actor_user_id_sha256 BYTEA PRIMARY KEY,
    username_sha256      BYTEA,
    erased_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erased_audit_actor_username_idx
    ON logging.erased_audit_actor (username_sha256)
    WHERE username_sha256 IS NOT NULL;

COMMENT ON TABLE logging.erased_audit_actor IS
    'SHA-256 of erased actor ids and usernames. Audit inserts anonymize their rows.';

-- Called by the erasure in its own transaction, before it anonymizes rows.
CREATE OR REPLACE FUNCTION logging.fn_audit_actor_fence(
    p_actor_user_id VARCHAR,
    p_username VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_actor_user_id IS NULL OR p_actor_user_id = '' THEN
        RAISE EXCEPTION 'audit actor fence needs an actor id'
            USING ERRCODE = '22004';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('logging.audit_actor_erasure'), 0);
    INSERT INTO logging.erased_audit_actor (
        actor_user_id_sha256, username_sha256
    ) VALUES (
        sha256(convert_to(p_actor_user_id, 'UTF8')),
        CASE
            WHEN NULLIF(p_username, '') IS NULL THEN NULL
            ELSE sha256(convert_to(p_username, 'UTF8'))
        END
    )
    ON CONFLICT (actor_user_id_sha256) DO UPDATE
       SET username_sha256 = COALESCE(
               EXCLUDED.username_sha256,
               logging.erased_audit_actor.username_sha256
           ),
           erased_at = now();
END;
$$;

-- Same match as the erasure's stored-row update. A username alone fences only
-- rows from before the erasure, so a later user with that name keeps theirs.
-- The fence is read in its own statement, after the shared lock is granted.
CREATE OR REPLACE FUNCTION logging.fn_audit_log_fence_erased_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.actor_user_id IS NULL AND NEW.username IS NULL THEN
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock_shared(
        hashtext('logging.audit_actor_erasure'), 0
    );
    IF EXISTS (
        SELECT 1
          FROM logging.erased_audit_actor f
         WHERE NEW.actor_user_id IS NOT NULL
           AND f.actor_user_id_sha256 =
               sha256(convert_to(NEW.actor_user_id, 'UTF8'))
    ) OR (
        NEW.actor_user_id IS NULL
        AND EXISTS (
            SELECT 1
              FROM logging.erased_audit_actor f
             WHERE f.username_sha256 = sha256(convert_to(NEW.username, 'UTF8'))
               AND NEW.ts <= f.erased_at
        )
    ) THEN
        NEW.username := '<deleted-user>';
        NEW.actor_user_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER audit_log_fence_erased_actor
BEFORE INSERT ON logging.audit_log
FOR EACH ROW EXECUTE FUNCTION logging.fn_audit_log_fence_erased_actor();

--------------DOWN
DROP TRIGGER IF EXISTS audit_log_fence_erased_actor ON logging.audit_log;
DROP FUNCTION IF EXISTS logging.fn_audit_log_fence_erased_actor();
DROP FUNCTION IF EXISTS logging.fn_audit_actor_fence(VARCHAR, VARCHAR);
DROP TABLE IF EXISTS logging.erased_audit_actor;
