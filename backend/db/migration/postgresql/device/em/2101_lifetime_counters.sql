--------------UP
-- CHECK constraints enforce the invariants the UPSERT function
-- already relies on: cumulative readings can't be negative, and the
-- frozen pre-reset accumulator only grows. Catching a violation here
-- is preferable to a silently corrupted display value down the line.

ALTER TABLE device_em.lifetime_counters
    ADD CONSTRAINT lifetime_counters_last_value_nonneg
        CHECK (last_value_wh >= 0);

ALTER TABLE device_em.lifetime_counters
    ADD CONSTRAINT lifetime_counters_offset_nonneg
        CHECK (lifetime_offset_wh >= 0);

--------------DOWN
ALTER TABLE device_em.lifetime_counters
    DROP CONSTRAINT IF EXISTS lifetime_counters_last_value_nonneg;
ALTER TABLE device_em.lifetime_counters
    DROP CONSTRAINT IF EXISTS lifetime_counters_offset_nonneg;
