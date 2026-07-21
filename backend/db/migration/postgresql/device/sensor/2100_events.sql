--------------UP
-- Forever binary/discrete sensor events (append-only). Binary sensors write on
-- state change; buttons write every push. No retention policy.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS device_sensor.events (
    ts      TIMESTAMPTZ NOT NULL,
    device  INTEGER     NOT NULL,
    source  VARCHAR(12) NOT NULL,
    kind    VARCHAR(24) NOT NULL,
    channel SMALLINT,
    state   SMALLINT    NOT NULL
);

SELECT create_hypertable('device_sensor.events', 'ts', chunk_time_interval => INTERVAL '30 days');

CREATE INDEX IF NOT EXISTS device_sensor__events_dev_kind
    ON device_sensor.events (device, kind, ts DESC);

ALTER TABLE device_sensor.events SET (
    timescaledb.compress = TRUE,
    timescaledb.compress_segmentby = 'device, kind',
    timescaledb.compress_orderby = 'ts'
);

SELECT add_compression_policy('device_sensor.events', compress_after => INTERVAL '7 days', if_not_exists => TRUE);
--------------DOWN
DROP TABLE IF EXISTS device_sensor.events;
