--------------UP
-- A decisive tag now outranks the domain when deriving commodity.
--
-- 6779 evaluated the domain branch first, so a row whose tag can only be water
-- or heat was stamped `commodity='electricity'` whenever its domain happened to
-- carry an electrical value. That row then passed the electricity read filter in
-- 6780 and its value was summed as watt-hours, so cubic metres landed in the kWh
-- total and in the cost derived from it.
--
-- The natural ingest path never produced that pair: bthomeSpec maps every volume
-- tag to domain 'unspecified', which fell through to the tag branch and resolved
-- to water correctly. The mismatch arrives through the operator override path,
-- energy.SetPointOverride, which writes tag and domain as two independent fields
-- with no check that they agree (pointOverrideHandler.ts). Declaring a water
-- point's domain 'ac_mains' silently converted its readings into electricity.
--
-- The ordering below is the honest one: a volume tag is never electricity, and a
-- thermal-energy tag is never electricity, whatever the domain says. The domain
-- keeps deciding only where the tag genuinely cannot: an electrical tag tells you
-- it is electricity but not whether it is mains, PV or battery.
--
-- Water-vs-gas is still not readable from a volume tag (both are L/m3), so an
-- explicit 'gas' domain continues to win over the volume default. That branch has
-- to stay ahead of the tag branch for exactly that reason.

SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_commodity_for(p_domain TEXT, p_tag TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        -- Operator-declared gas: the only thing that can tell gas from water.
        WHEN p_domain = 'gas' THEN 'gas'
        -- Tags that carry their own commodity, whatever the domain claims.
        WHEN p_tag IN ('volume_l','volume_m3','volume_storage_l','volume_flow_m3h') THEN 'water'
        WHEN p_tag = 'thermal_energy_kwh' THEN 'heat'
        WHEN p_domain = 'thermal' THEN 'heat'
        -- Domain decides only what the tag cannot: which kind of electricity.
        WHEN p_domain IN ('ac_mains','dc_pv','dc_battery','dc_bus') THEN 'electricity'
        ELSE 'electricity'
    END;
$$;

-- Restamp only the rows the corrected ordering actually moves. The WHERE keeps
-- the cost bounded to genuinely mis-stamped rows, which is the same guard 6779
-- used; on a fleet with no overridden water or heat points it matches nothing.
-- All three tables can hold compressed chunks, so lift the per-transaction
-- decompression cap before the first UPDATE, as 6779 does.
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

UPDATE device_em.energy_15min
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);

UPDATE device_em.lifetime_counters
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);

UPDATE device_em.stats
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);
--------------DOWN
-- Restores 6779's ordering, and restamps back so the data matches whichever
-- definition is installed.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_commodity_for(p_domain TEXT, p_tag TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_domain IN ('ac_mains','dc_pv','dc_battery','dc_bus') THEN 'electricity'
        WHEN p_domain = 'gas' THEN 'gas'
        WHEN p_domain = 'thermal' THEN 'heat'
        WHEN p_tag IN ('volume_l','volume_m3','volume_storage_l','volume_flow_m3h') THEN 'water'
        WHEN p_tag = 'thermal_energy_kwh' THEN 'heat'
        ELSE 'electricity'
    END;
$$;

SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

UPDATE device_em.energy_15min
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);

UPDATE device_em.lifetime_counters
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);

UPDATE device_em.stats
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);
