--------------UP
-- A gas tariff may bill converted energy; units match tariffQuantity.ts and 7362.
ALTER TABLE organization.tariff
    DROP CONSTRAINT IF EXISTS organization__tariff_commodity_unit;
ALTER TABLE organization.tariff
    ADD CONSTRAINT organization__tariff_commodity_unit CHECK (
        (commodity = 'electricity' AND billed_unit = 'kWh')
        OR (commodity = 'water' AND billed_unit IN ('m3', 'l'))
        OR (commodity = 'gas' AND billed_unit IN ('m3', 'kWh', 'therm', 'MMBtu', 'GJ'))
        OR (commodity = 'heat' AND billed_unit = 'kWh')
    );

--------------DOWN
-- OPERATOR ACTION REQUIRED: export gas energy tariffs before DOWN; it refuses rather than deletes them.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM organization.tariff
         WHERE commodity = 'gas' AND billed_unit <> 'm3'
    ) THEN
        RAISE EXCEPTION 'Cannot roll back gas energy tariff units while gas tariffs bill a unit other than m3';
    END IF;
END;
$$;

ALTER TABLE organization.tariff
    DROP CONSTRAINT IF EXISTS organization__tariff_commodity_unit;
ALTER TABLE organization.tariff
    ADD CONSTRAINT organization__tariff_commodity_unit CHECK (
        (commodity = 'electricity' AND billed_unit = 'kWh')
        OR (commodity = 'water' AND billed_unit IN ('m3', 'l'))
        OR (commodity = 'gas' AND billed_unit = 'm3')
        OR (commodity = 'heat' AND billed_unit = 'kWh')
    );
