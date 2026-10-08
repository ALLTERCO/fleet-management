--------------UP
-- One receipt per producer batch makes Redis retry and PostgreSQL fallback
-- converge on the same exactly-once write. Receipts are small and permanent:
-- deleting one could make a delayed Redis replay count the readings twice.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS device_sensor.capture_batch_receipt (
    batch_id VARCHAR(100) PRIMARY KEY,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION device_sensor.fn_append_capture_batches(
    p_batch_ids          VARCHAR(100)[],
    p_numeric_batch_ids  VARCHAR(100)[],
    p_numeric_device     INT[],
    p_numeric_source     VARCHAR(12)[],
    p_numeric_kind       VARCHAR(24)[],
    p_numeric_channel    SMALLINT[],
    p_numeric_ts         BIGINT[],
    p_numeric_val        REAL[],
    p_event_batch_ids    VARCHAR(100)[],
    p_event_device       INT[],
    p_event_source       VARCHAR(12)[],
    p_event_kind         VARCHAR(24)[],
    p_event_channel      SMALLINT[],
    p_event_ts           BIGINT[],
    p_event_state        SMALLINT[]
)
RETURNS JSONB
LANGUAGE plpgsql
AS
$$
DECLARE
    v_new_batch_ids VARCHAR(100)[];
    v_numeric_device INT[];
    v_numeric_source VARCHAR(12)[];
    v_numeric_kind VARCHAR(24)[];
    v_numeric_channel SMALLINT[];
    v_numeric_ts BIGINT[];
    v_numeric_val REAL[];
    v_event_device INT[];
    v_event_source VARCHAR(12)[];
    v_event_kind VARCHAR(24)[];
    v_event_channel SMALLINT[];
    v_event_ts BIGINT[];
    v_event_state SMALLINT[];
    v_committed_rows INT := 0;
BEGIN
    IF cardinality(p_batch_ids) = 0 OR EXISTS (
        SELECT 1 FROM unnest(p_batch_ids) AS id WHERE id IS NULL OR id = ''
    ) THEN
        RAISE EXCEPTION 'sensor capture requires non-empty batch ids';
    END IF;

    IF cardinality(p_numeric_batch_ids) <> cardinality(p_numeric_device)
       OR cardinality(p_numeric_device) <> cardinality(p_numeric_source)
       OR cardinality(p_numeric_device) <> cardinality(p_numeric_kind)
       OR cardinality(p_numeric_device) <> cardinality(p_numeric_channel)
       OR cardinality(p_numeric_device) <> cardinality(p_numeric_ts)
       OR cardinality(p_numeric_device) <> cardinality(p_numeric_val)
       OR cardinality(p_event_batch_ids) <> cardinality(p_event_device)
       OR cardinality(p_event_device) <> cardinality(p_event_source)
       OR cardinality(p_event_device) <> cardinality(p_event_kind)
       OR cardinality(p_event_device) <> cardinality(p_event_channel)
       OR cardinality(p_event_device) <> cardinality(p_event_ts)
       OR cardinality(p_event_device) <> cardinality(p_event_state) THEN
        RAISE EXCEPTION 'sensor capture row arrays must have equal lengths';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM unnest(p_numeric_batch_ids || p_event_batch_ids) AS row_batch_id
         WHERE NOT (row_batch_id = ANY(p_batch_ids))
    ) THEN
        RAISE EXCEPTION 'sensor capture row references an unknown batch id';
    END IF;

    WITH inserted AS (
        INSERT INTO device_sensor.capture_batch_receipt (batch_id)
        SELECT DISTINCT id FROM unnest(p_batch_ids) AS id
        ON CONFLICT (batch_id) DO NOTHING
        RETURNING batch_id
    )
    SELECT COALESCE(array_agg(batch_id), ARRAY[]::VARCHAR(100)[])
      INTO v_new_batch_ids
      FROM inserted;

    SELECT array_agg(device ORDER BY ord),
           array_agg(source ORDER BY ord),
           array_agg(kind ORDER BY ord),
           array_agg(channel ORDER BY ord),
           array_agg(ts ORDER BY ord),
           array_agg(val ORDER BY ord)
      INTO v_numeric_device,
           v_numeric_source,
           v_numeric_kind,
           v_numeric_channel,
           v_numeric_ts,
           v_numeric_val
      FROM unnest(
          p_numeric_batch_ids,
          p_numeric_device,
          p_numeric_source,
          p_numeric_kind,
          p_numeric_channel,
          p_numeric_ts,
          p_numeric_val
      ) WITH ORDINALITY AS row_data(
          batch_id, device, source, kind, channel, ts, val, ord
      )
     WHERE batch_id = ANY(v_new_batch_ids);

    IF cardinality(v_numeric_device) > 0 THEN
        PERFORM device_sensor.fn_append_numeric_15min(
            v_numeric_device,
            v_numeric_source,
            v_numeric_kind,
            v_numeric_channel,
            v_numeric_ts,
            v_numeric_val
        );
        v_committed_rows := v_committed_rows + cardinality(v_numeric_device);
    END IF;

    SELECT array_agg(device ORDER BY ord),
           array_agg(source ORDER BY ord),
           array_agg(kind ORDER BY ord),
           array_agg(channel ORDER BY ord),
           array_agg(ts ORDER BY ord),
           array_agg(state ORDER BY ord)
      INTO v_event_device,
           v_event_source,
           v_event_kind,
           v_event_channel,
           v_event_ts,
           v_event_state
      FROM unnest(
          p_event_batch_ids,
          p_event_device,
          p_event_source,
          p_event_kind,
          p_event_channel,
          p_event_ts,
          p_event_state
      ) WITH ORDINALITY AS row_data(
          batch_id, device, source, kind, channel, ts, state, ord
      )
     WHERE batch_id = ANY(v_new_batch_ids);

    IF cardinality(v_event_device) > 0 THEN
        PERFORM device_sensor.fn_append_events(
            v_event_device,
            v_event_source,
            v_event_kind,
            v_event_channel,
            v_event_ts,
            v_event_state
        );
        v_committed_rows := v_committed_rows + cardinality(v_event_device);
    END IF;

    RETURN jsonb_build_object(
        'committedBatches', cardinality(v_new_batch_ids),
        'committedRows', v_committed_rows
    );
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_sensor.fn_append_capture_batches(
    VARCHAR(100)[],
    VARCHAR(100)[],
    INT[],
    VARCHAR(12)[],
    VARCHAR(24)[],
    SMALLINT[],
    BIGINT[],
    REAL[],
    VARCHAR(100)[],
    INT[],
    VARCHAR(12)[],
    VARCHAR(24)[],
    SMALLINT[],
    BIGINT[],
    SMALLINT[]
);
DROP TABLE IF EXISTS device_sensor.capture_batch_receipt;
