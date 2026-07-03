--------------UP
-- Atomic admit-by-id: UPDATE...RETURNING the post-update row state in
-- one query. Replaces the (allow_batch + fetch_batch_by_ids) two-call
-- chain in WaitingRoom.acceptPendingById — closes the window where an
-- ID was flipped to ALLOWED but went missing from the follow-up fetch
-- (e.g., concurrent delete), leaving DB state inconsistent with the
-- in-memory pending map.
CREATE FUNCTION device.fn_admit_batch_by_ids(
    p_ids            INT[],
    p_control_access SMALLINT
)
RETURNS TABLE (
    external_id    VARCHAR(50),
    id             INT,
    control_access SMALLINT,
    created        TIMESTAMPTZ,
    updated        TIMESTAMPTZ,
    jdoc           JSONB
)
AS
$$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE device.list d
       SET control_access = p_control_access,
           updated        = NOW()::TIMESTAMPTZ
     WHERE d.id = ANY(p_ids)
    RETURNING d.external_id, d.id, d.control_access,
              d.created, d.updated, d.jdoc;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION device.fn_admit_batch_by_ids;
