--------------UP
-- Upsert (or delete) one assignment row. Org-scoped; verifies the tariff is in
-- the org before attaching. p_delete=true removes the matching point.
CREATE OR REPLACE FUNCTION organization.fn_tariff_assign(
    p_org VARCHAR, p_payload JSONB, p_delete BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_tariff INTEGER := (p_payload->>'tariffId')::INTEGER;
    v_level  VARCHAR := p_payload->>'scopeLevel';
    v_dash   INTEGER := (p_payload->>'dashboardId')::INTEGER;
    v_dev    VARCHAR := p_payload->>'deviceExternalId';
    v_chan   SMALLINT := (p_payload->>'channel')::SMALLINT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organization.tariff WHERE id=v_tariff AND organization_id=p_org) THEN
        RAISE EXCEPTION 'tariff % not in org %', v_tariff, p_org;
    END IF;
    IF p_delete THEN
        DELETE FROM organization.tariff_assignment
        WHERE organization_id=p_org AND scope_level=v_level
          AND COALESCE(dashboard_id,-1)=COALESCE(v_dash,-1)
          AND COALESCE(device_external_id,'')=COALESCE(v_dev,'')
          AND COALESCE(channel,-1)=COALESCE(v_chan,-1);
        RETURN;
    END IF;
    INSERT INTO organization.tariff_assignment
        (organization_id, tariff_id, scope_level, dashboard_id, device_external_id, channel)
    VALUES (p_org, v_tariff, v_level, v_dash, v_dev, v_chan)
    ON CONFLICT (organization_id, scope_level, COALESCE(dashboard_id,-1),
                 COALESCE(device_external_id,''), COALESCE(channel,-1))
    DO UPDATE SET tariff_id=EXCLUDED.tariff_id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_assign(VARCHAR, JSONB, BOOLEAN);
