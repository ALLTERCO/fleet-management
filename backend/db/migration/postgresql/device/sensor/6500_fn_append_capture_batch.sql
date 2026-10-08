--------------UP
-- Commit one strictly ordered Redis sensor-capture batch atomically. The
-- single per-stream watermark makes replay after an XDEL failure idempotent
-- without a receipt row per reading. The drainer must always submit the
-- oldest remaining Redis entries first.
SET search_path TO public;

CREATE TABLE device_sensor.capture_watermark (
    stream_key VARCHAR(255) PRIMARY KEY,
    last_ms BIGINT NOT NULL DEFAULT 0 CHECK (last_ms >= 0),
    last_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION device_sensor.fn_append_capture_batch(
    p_stream_key       VARCHAR(255),
    p_last_ms          BIGINT,
    p_last_seq         BIGINT,
    p_numeric_device   INT[],
    p_numeric_source   VARCHAR(12)[],
    p_numeric_kind     VARCHAR(24)[],
    p_numeric_channel  SMALLINT[],
    p_numeric_ts       BIGINT[],
    p_numeric_val      REAL[],
    p_event_device     INT[],
    p_event_source     VARCHAR(12)[],
    p_event_kind       VARCHAR(24)[],
    p_event_channel    SMALLINT[],
    p_event_ts         BIGINT[],
    p_event_state      SMALLINT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS
$$
DECLARE
    v_last_ms BIGINT;
    v_last_seq BIGINT;
BEGIN
    IF p_last_ms < 0 OR p_last_seq < 0 THEN
        RAISE EXCEPTION 'sensor capture stream id must be non-negative';
    END IF;

    INSERT INTO device_sensor.capture_watermark (stream_key)
    VALUES (p_stream_key)
    ON CONFLICT (stream_key) DO NOTHING;

    SELECT last_ms, last_seq
      INTO v_last_ms, v_last_seq
      FROM device_sensor.capture_watermark
     WHERE stream_key = p_stream_key
       FOR UPDATE;

    IF (p_last_ms, p_last_seq) <= (v_last_ms, v_last_seq) THEN
        RETURN FALSE;
    END IF;

    IF cardinality(p_numeric_device) > 0 THEN
        PERFORM device_sensor.fn_append_numeric_15min(
            p_numeric_device,
            p_numeric_source,
            p_numeric_kind,
            p_numeric_channel,
            p_numeric_ts,
            p_numeric_val
        );
    END IF;

    IF cardinality(p_event_device) > 0 THEN
        PERFORM device_sensor.fn_append_events(
            p_event_device,
            p_event_source,
            p_event_kind,
            p_event_channel,
            p_event_ts,
            p_event_state
        );
    END IF;

    UPDATE device_sensor.capture_watermark
       SET last_ms = p_last_ms,
           last_seq = p_last_seq,
           updated_at = NOW()
     WHERE stream_key = p_stream_key;

    RETURN TRUE;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_sensor.fn_append_capture_batch(
    VARCHAR(255),
    BIGINT,
    BIGINT,
    INT[],
    VARCHAR(12)[],
    VARCHAR(24)[],
    SMALLINT[],
    BIGINT[],
    REAL[],
    INT[],
    VARCHAR(12)[],
    VARCHAR(24)[],
    SMALLINT[],
    BIGINT[],
    SMALLINT[]
);
DROP TABLE IF EXISTS device_sensor.capture_watermark;
