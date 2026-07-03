--------------UP
-- Per-(device, channel, tag) running count of resets detected so far.
-- Drives the Energy.GetResetAudit RPC + the lifetime_resets_total
-- observability counter so operators can see "this device has reset
-- 47 times" (likely a firmware glitch) without scraping logs.

ALTER TABLE device_em.lifetime_counters
    ADD COLUMN IF NOT EXISTS reset_count INT NOT NULL DEFAULT 0;

ALTER TABLE device_em.lifetime_counters
    ADD CONSTRAINT lifetime_counters_reset_count_nonneg
        CHECK (reset_count >= 0);
--------------DOWN
ALTER TABLE device_em.lifetime_counters
    DROP CONSTRAINT IF EXISTS lifetime_counters_reset_count_nonneg;
ALTER TABLE device_em.lifetime_counters
    DROP COLUMN IF EXISTS reset_count;
