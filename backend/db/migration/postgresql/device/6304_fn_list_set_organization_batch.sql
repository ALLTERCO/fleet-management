--------------UP
-- Batch variant of fn_list_set_organization. Replaces the per-device write
-- loop in WaitingRoomComponent.acceptPendingById and any future bulk
-- admit flows. Returns the external_ids that actually matched a row so
-- callers can report partial misses.
CREATE FUNCTION device.fn_list_set_organization_batch(
    p_external_ids VARCHAR[],
    p_organization_id VARCHAR
)
RETURNS TABLE (external_id VARCHAR)
LANGUAGE sql
AS $$
    UPDATE device.list
    SET organization_id = p_organization_id,
        updated = NOW()
    WHERE external_id = ANY(p_external_ids)
    RETURNING external_id;
$$;
--------------DOWN
DROP FUNCTION device.fn_list_set_organization_batch;
