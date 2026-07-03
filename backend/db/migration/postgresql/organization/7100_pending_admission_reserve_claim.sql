--------------UP
-- Make auto-admit reservation atomic. The old reserve was a plain SELECT, so
-- two concurrent reconnects of the same device both passed it and both ran
-- bind+approve. Now reserve is an UPDATE that row-locks and stamps reserved_at,
-- so only one caller wins; a stale claim (older than the grace window, e.g. a
-- crashed admit) is reclaimable so the next reconnect can retry.
ALTER TABLE organization.pending_admission
    ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS organization.fn_pending_admission_reserve(TEXT);
CREATE OR REPLACE FUNCTION organization.fn_pending_admission_reserve(
    p_shelly_id             TEXT,
    p_reserve_grace_seconds INTEGER
)
RETURNS SETOF organization.pending_admission
LANGUAGE sql
AS $$
    UPDATE organization.pending_admission
       SET reserved_at = now()
     WHERE shelly_id = p_shelly_id
       AND consumed_at IS NULL
       AND expires_at > now()
       AND (
           reserved_at IS NULL
           OR reserved_at < now() - make_interval(secs => p_reserve_grace_seconds)
       )
    RETURNING *;
$$;

--------------DOWN
-- Restore the 6574 shape exactly: 1-arg, SETOF, sql STABLE (NOT the 6573
-- composite). The live 2-arg caller is gone after this rollback.
DROP FUNCTION IF EXISTS organization.fn_pending_admission_reserve(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION organization.fn_pending_admission_reserve(
    p_shelly_id TEXT
)
RETURNS SETOF organization.pending_admission
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM organization.pending_admission
     WHERE shelly_id = p_shelly_id
       AND consumed_at IS NULL
       AND expires_at > now();
$$;
ALTER TABLE organization.pending_admission DROP COLUMN IF EXISTS reserved_at;
