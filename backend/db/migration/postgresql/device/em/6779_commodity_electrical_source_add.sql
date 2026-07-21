--------------UP
-- Proper energy identity model: split the overloaded `domain` into two honest,
-- orthogonal columns that every metering standard keeps separate (DLMS/OBIS
-- medium, M-Bus Medium byte, CIM commodity, Matter cluster, SunSpec model):
--   commodity         electricity | water | gas | heat   (primary identity)
--   electrical_source ac_mains | dc_pv | dc_battery | dc_bus  (electricity only)
-- `thermal` was a commodity masquerading as a domain; water/gas fell through to
-- `unspecified`. Both new columns are DERIVED from (domain, tag) by ONE SSOT pair
-- of functions, stamped at ingest by a BEFORE INSERT trigger (so every append
-- path stamps them with zero function rewrites) and backfilled for existing rows.
-- domain stays as the raw classifier output + dedup key; the reads switch to the
-- two clean axes. Adding a plain column with a constant default is a fast
-- metadata-only change even on the compressed stats hypertable; the row backfill
-- below covers all three tables (stats included).

SET search_path TO device_em, public;

-- SSOT mapping. One definition, used by the ingest trigger, the backfill, and
-- (via the columns) every reader. Water-vs-gas is not readable from a volume tag
-- (both are L/m3), so volume defaults to water; a future classifier/operator can
-- set gas explicitly at ingest.
CREATE OR REPLACE FUNCTION device_em.fn_commodity_for(p_domain TEXT, p_tag TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_domain IN ('ac_mains','dc_pv','dc_battery','dc_bus') THEN 'electricity'
        WHEN p_domain = 'gas' THEN 'gas'        -- classifier told water from gas by name
        WHEN p_domain = 'thermal' THEN 'heat'
        WHEN p_tag IN ('volume_l','volume_m3','volume_storage_l','volume_flow_m3h') THEN 'water'
        WHEN p_tag = 'thermal_energy_kwh' THEN 'heat'
        ELSE 'electricity'
    END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_electrical_source_for(p_domain TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_domain IN ('ac_mains','dc_pv','dc_battery','dc_bus') THEN p_domain
        ELSE NULL
    END;
$$;

ALTER TABLE device_em.stats
    ADD COLUMN IF NOT EXISTS commodity VARCHAR(12) NOT NULL DEFAULT 'electricity';
ALTER TABLE device_em.stats
    ADD COLUMN IF NOT EXISTS electrical_source VARCHAR(16) NULL;
ALTER TABLE device_em.energy_15min
    ADD COLUMN IF NOT EXISTS commodity VARCHAR(12) NOT NULL DEFAULT 'electricity';
ALTER TABLE device_em.energy_15min
    ADD COLUMN IF NOT EXISTS electrical_source VARCHAR(16) NULL;
ALTER TABLE device_em.lifetime_counters
    ADD COLUMN IF NOT EXISTS commodity VARCHAR(12) NOT NULL DEFAULT 'electricity';
ALTER TABLE device_em.lifetime_counters
    ADD COLUMN IF NOT EXISTS electrical_source VARCHAR(16) NULL;

-- Stamp both axes on every insert, from any append function. BEFORE INSERT so
-- it also covers the INSERT arm of ON CONFLICT upserts; the conflict key already
-- includes domain, so a conflicting row keeps the same derived values.
CREATE OR REPLACE FUNCTION device_em.fn_stamp_commodity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.commodity := device_em.fn_commodity_for(NEW.domain, NEW.tag);
    NEW.electrical_source := device_em.fn_electrical_source_for(NEW.domain);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_commodity ON device_em.stats;
CREATE TRIGGER trg_stamp_commodity BEFORE INSERT ON device_em.stats
    FOR EACH ROW EXECUTE FUNCTION device_em.fn_stamp_commodity();
DROP TRIGGER IF EXISTS trg_stamp_commodity ON device_em.energy_15min;
CREATE TRIGGER trg_stamp_commodity BEFORE INSERT ON device_em.energy_15min
    FOR EACH ROW EXECUTE FUNCTION device_em.fn_stamp_commodity();
DROP TRIGGER IF EXISTS trg_stamp_commodity ON device_em.lifetime_counters;
CREATE TRIGGER trg_stamp_commodity BEFORE INSERT ON device_em.lifetime_counters
    FOR EACH ROW EXECUTE FUNCTION device_em.fn_stamp_commodity();

-- Backfill EVERY existing row on both axes. The WHERE must test commodity too,
-- not just electrical_source: a water/heat row keeps electrical_source NULL before
-- and after (NULL IS DISTINCT FROM NULL = FALSE), so a source-only guard would skip
-- it and leave its commodity at the 'electricity' default — the exact empty-report
-- bug this migration fixes. All three tables can have compressed chunks, so lift
-- the per-txn decompression cap BEFORE the first UPDATE (SET LOCAL holds for the
-- rest of this migration transaction). Cost is bounded by the WHERE (only rows
-- that actually change decompress) + the ~1-month raw retention on stats.
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

UPDATE device_em.energy_15min
SET commodity = device_em.fn_commodity_for(domain, tag),
    electrical_source = device_em.fn_electrical_source_for(domain)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag)
   OR electrical_source IS DISTINCT FROM device_em.fn_electrical_source_for(domain);

UPDATE device_em.lifetime_counters
SET commodity = device_em.fn_commodity_for(domain, tag),
    electrical_source = device_em.fn_electrical_source_for(domain)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag)
   OR electrical_source IS DISTINCT FROM device_em.fn_electrical_source_for(domain);

UPDATE device_em.stats
SET commodity = device_em.fn_commodity_for(domain, tag),
    electrical_source = device_em.fn_electrical_source_for(domain)
WHERE commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag)
   OR electrical_source IS DISTINCT FROM device_em.fn_electrical_source_for(domain);
--------------DOWN
SET search_path TO device_em, public;
DROP TRIGGER IF EXISTS trg_stamp_commodity ON device_em.stats;
DROP TRIGGER IF EXISTS trg_stamp_commodity ON device_em.energy_15min;
DROP TRIGGER IF EXISTS trg_stamp_commodity ON device_em.lifetime_counters;
DROP FUNCTION IF EXISTS device_em.fn_stamp_commodity();
ALTER TABLE device_em.stats DROP COLUMN IF EXISTS electrical_source;
ALTER TABLE device_em.stats DROP COLUMN IF EXISTS commodity;
ALTER TABLE device_em.energy_15min DROP COLUMN IF EXISTS electrical_source;
ALTER TABLE device_em.energy_15min DROP COLUMN IF EXISTS commodity;
ALTER TABLE device_em.lifetime_counters DROP COLUMN IF EXISTS electrical_source;
ALTER TABLE device_em.lifetime_counters DROP COLUMN IF EXISTS commodity;
DROP FUNCTION IF EXISTS device_em.fn_commodity_for(TEXT, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_electrical_source_for(TEXT);
