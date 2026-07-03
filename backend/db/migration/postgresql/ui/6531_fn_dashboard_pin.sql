--------------UP
DROP FUNCTION IF EXISTS ui.fn_dashboard_pin(VARCHAR, INT, INT);
CREATE FUNCTION ui.fn_dashboard_pin(
    p_user_id    VARCHAR,
    p_dashboard_id INT,
    p_sort_order INT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_order INT;
BEGIN
    IF p_sort_order IS NULL THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO r_order
          FROM ui.dashboard_pin
         WHERE user_id = p_user_id;
    ELSE
        r_order := p_sort_order;
    END IF;
    INSERT INTO ui.dashboard_pin (user_id, dashboard_id, sort_order)
    VALUES (p_user_id, p_dashboard_id, r_order)
    ON CONFLICT (user_id, dashboard_id)
        DO UPDATE SET sort_order = EXCLUDED.sort_order;
    RETURN TRUE;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_unpin(VARCHAR, INT);
CREATE FUNCTION ui.fn_dashboard_unpin(
    p_user_id    VARCHAR,
    p_dashboard_id INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    DELETE FROM ui.dashboard_pin
     WHERE user_id = p_user_id AND dashboard_id = p_dashboard_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_list_pinned(VARCHAR);
CREATE FUNCTION ui.fn_dashboard_list_pinned(p_user_id VARCHAR)
RETURNS TABLE (
    dashboard_id INT,
    sort_order   INT,
    pinned_at    TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT dashboard_id, sort_order, pinned_at
      FROM ui.dashboard_pin
     WHERE user_id = p_user_id
     ORDER BY sort_order, pinned_at;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_reorder_pins(VARCHAR, INT[]);
CREATE FUNCTION ui.fn_dashboard_reorder_pins(
    p_user_id VARCHAR,
    p_ids     INT[]
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT := 0;
    i INT;
BEGIN
    FOR i IN 1 .. COALESCE(array_length(p_ids, 1), 0) LOOP
        UPDATE ui.dashboard_pin
           SET sort_order = i - 1
         WHERE user_id = p_user_id AND dashboard_id = p_ids[i];
        IF FOUND THEN r_count := r_count + 1; END IF;
    END LOOP;
    RETURN r_count;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_pin(VARCHAR, INT, INT);
DROP FUNCTION IF EXISTS ui.fn_dashboard_unpin(VARCHAR, INT);
DROP FUNCTION IF EXISTS ui.fn_dashboard_list_pinned(VARCHAR);
DROP FUNCTION IF EXISTS ui.fn_dashboard_reorder_pins(VARCHAR, INT[]);
