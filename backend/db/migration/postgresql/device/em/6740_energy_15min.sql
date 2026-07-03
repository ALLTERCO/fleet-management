--------------UP
-- Long-term 15-minute energy rollup. A managed table (not a continuous
-- aggregate) so it can be maintained as data ARRIVES — including emSync's
-- late backfill of offline gaps — which lets raw device_em.stats keep only a
-- short window while the rollup stays correct. One row per
-- (bucket, device, phase, channel, tag, domain); sum_val + sample_count let a
-- reader take SUM for energy-delta tags and sum_val/sample_count (avg) for
-- instantaneous tags. compress_segmentby includes tag (raw omits it), so
-- year-range reads skip irrelevant tags without decompressing.
--
-- Restore `public` so the TimescaleDB functions (create_hypertable,
-- add_compression_policy) resolve — later em migrations leave search_path at
-- `device_em`, where these functions are not visible.
SET search_path TO device_em, public;

CREATE TABLE IF NOT EXISTS device_em.energy_15min (
    bucket       TIMESTAMP WITH TIME ZONE NOT NULL,
    device       INTEGER NOT NULL,
    phase        VARCHAR(1),
    channel      SMALLINT,
    tag          VARCHAR(30) NOT NULL,
    domain       VARCHAR(16) NOT NULL DEFAULT 'ac_mains',
    sum_val      DOUBLE PRECISION NOT NULL DEFAULT 0,
    sample_count BIGINT NOT NULL DEFAULT 0,
    min_val      DOUBLE PRECISION,
    max_val      DOUBLE PRECISION
);

SELECT create_hypertable('device_em.energy_15min', 'bucket', chunk_time_interval => INTERVAL '30 days');

-- Idempotency key for the ON CONFLICT upsert. NULLS NOT DISTINCT (PG15+) so a
-- NULL phase/channel still collapses to one row instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS device_em__energy_15min_key ON device_em.energy_15min (bucket, device, tag, domain, phase, channel) NULLS NOT DISTINCT;

ALTER TABLE device_em.energy_15min SET (timescaledb.compress = TRUE, timescaledb.compress_segmentby = 'device, tag', timescaledb.compress_orderby = 'bucket');

SELECT add_compression_policy('device_em.energy_15min', compress_after => INTERVAL '7 days', if_not_exists => TRUE);
--------------DOWN
DROP TABLE IF EXISTS device_em.energy_15min;
