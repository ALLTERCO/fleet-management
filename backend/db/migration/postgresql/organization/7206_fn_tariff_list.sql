--------------UP
CREATE OR REPLACE FUNCTION organization.fn_tariff_list(p_org VARCHAR)
RETURNS TABLE (id INTEGER, name VARCHAR, kind VARCHAR, currency VARCHAR)
LANGUAGE sql STABLE
AS $$
    SELECT id, name, kind, currency FROM organization.tariff
    WHERE organization_id=p_org ORDER BY name;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_list(VARCHAR);
