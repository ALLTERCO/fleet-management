--------------UP
-- Persist a per-user dashboard ordering. Caller passes the canonical
-- visible-id list (validated by the RPC layer); SQL rewrites positions
-- atomically so display_order stays contiguous 0..N-1.
DROP FUNCTION IF EXISTS ui.fn_dashboard_reorder(VARCHAR, BIGINT[]);
CREATE FUNCTION ui.fn_dashboard_reorder(
    p_user_id VARCHAR,
    p_ids     BIGINT[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Wipe old positions for this user so we don't leave gaps from
    -- dashboards the user has lost access to since the last reorder.
    DELETE FROM ui.dashboard_order_user
     WHERE user_id = p_user_id;

    -- Rebuild dense 0..N-1 positions.
    IF array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO ui.dashboard_order_user (
        user_id, dashboard_id, display_order, updated_at
    )
    SELECT p_user_id, id, ord - 1, NOW()
      FROM unnest(p_ids) WITH ORDINALITY AS t(id, ord);
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_reorder(VARCHAR, BIGINT[]);
