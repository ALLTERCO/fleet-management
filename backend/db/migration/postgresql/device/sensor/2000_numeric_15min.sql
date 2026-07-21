--------------UP
-- Forever 15-min numeric sensor rollup. avg = sum_val/sample_count, no delta.
-- No retention policy. source separates internal chip temp from ambient sources.
-- public only (objects fully qualified); do not leak the schema to later migrations.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS device_sensor.numeric_15min (
    bucket       TIMESTAMPTZ NOT NULL,
    device       INTEGER      NOT NULL,
    source       VARCHAR(12)  NOT NULL,
    kind         VARCHAR(24)  NOT NULL,
    channel      SMALLINT,
    sum_val      DOUBLE PRECISION NOT NULL DEFAULT 0,
    sample_count BIGINT       NOT NULL DEFAULT 0,
    min_val      DOUBLE PRECISION,
    max_val      DOUBLE PRECISION
);

SELECT create_hypertable('device_sensor.numeric_15min', 'bucket', chunk_time_interval => INTERVAL '30 days');

CREATE UNIQUE INDEX IF NOT EXISTS device_sensor__numeric_15min_key
    ON device_sensor.numeric_15min (bucket, device, source, kind, channel) NULLS NOT DISTINCT;

ALTER TABLE device_sensor.numeric_15min SET (
    timescaledb.compress = TRUE,
    timescaledb.compress_segmentby = 'device, kind',
    timescaledb.compress_orderby = 'bucket'
);

SELECT add_compression_policy('device_sensor.numeric_15min', compress_after => INTERVAL '7 days', if_not_exists => TRUE);
--------------DOWN
DROP TABLE IF EXISTS device_sensor.numeric_15min;
