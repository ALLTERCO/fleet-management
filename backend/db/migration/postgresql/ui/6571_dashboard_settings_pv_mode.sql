--------------UP
-- Set PV mode without touching the refs. Grid/generation are logical-meter
-- roles now; the modal sends mode only and must not clobber the fallback refs.
SET search_path TO ui, public;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_set_pv_mode(
    p_dashboard_id INT,
    p_pv_mode      VARCHAR(16)
)
RETURNS VOID
LANGUAGE sql AS $$
    UPDATE ui.dashboard_settings
       SET pv_mode = p_pv_mode,
           updated = CURRENT_TIMESTAMP
     WHERE dashboard_id = p_dashboard_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_set_pv_mode(INT, VARCHAR);
