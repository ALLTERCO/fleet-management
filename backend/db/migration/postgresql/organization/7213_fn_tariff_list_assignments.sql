--------------UP
-- All tariff assignments for an org — the report resolves each (device, channel)
-- to its most-specific tariff (channel > device > dashboard default).
CREATE OR REPLACE FUNCTION organization.fn_tariff_list_assignments(p_org VARCHAR)
RETURNS TABLE (
    scope_level        VARCHAR,
    dashboard_id       INTEGER,
    device_external_id VARCHAR,
    channel            SMALLINT,
    tariff_id          INTEGER
)
LANGUAGE sql STABLE
AS $$
    SELECT scope_level, dashboard_id, device_external_id, channel, tariff_id
    FROM organization.tariff_assignment
    WHERE organization_id = p_org;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_list_assignments(VARCHAR);
