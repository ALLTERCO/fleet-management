--------------UP
CREATE TABLE IF NOT EXISTS device_em.lifetime_counters (
    device              INT NOT NULL,
    channel             SMALLINT NOT NULL,
    tag                 VARCHAR(30) NOT NULL,
    last_value_wh       NUMERIC(28, 8) NOT NULL,
    lifetime_offset_wh  NUMERIC(28, 8) NOT NULL DEFAULT 0,
    last_seen_ts        TIMESTAMP WITH TIME ZONE NOT NULL,
    last_reset_ts       TIMESTAMP WITH TIME ZONE NULL,
    PRIMARY KEY (device, channel, tag)
);

CREATE INDEX IF NOT EXISTS lifetime_counters_device_idx
    ON device_em.lifetime_counters (device);

COMMENT ON TABLE device_em.lifetime_counters IS
    'Monotonic cumulative energy per (device, channel, tag). Display = lifetime_offset_wh + last_value_wh.';
COMMENT ON COLUMN device_em.lifetime_counters.last_value_wh IS
    'Most recent absolute reading from the device, in Wh.';
COMMENT ON COLUMN device_em.lifetime_counters.lifetime_offset_wh IS
    'Sum of all prior peaks before counter resets — frozen across resets so display stays monotonic.';
COMMENT ON COLUMN device_em.lifetime_counters.last_reset_ts IS
    'Timestamp of the last detected counter reset (current < prior). NULL until first reset.';
--------------DOWN
DROP TABLE IF EXISTS device_em.lifetime_counters;
