--------------UP
CREATE OR REPLACE FUNCTION organization.fn_tariff_delete(p_org VARCHAR, p_id INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE v_n INTEGER;
BEGIN
    DELETE FROM organization.tariff WHERE id=p_id AND organization_id=p_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_delete(VARCHAR, INTEGER);
