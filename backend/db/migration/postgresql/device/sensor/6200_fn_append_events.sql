--------------UP
-- Append binary/discrete sensor events. Append-only; the caller decides what to
-- send (binary: on state change; button: every push). Function-scoped SET lifts
-- the decompression cap for a late event hitting a compressed chunk.
SET search_path TO public;

CREATE OR REPLACE FUNCTION device_sensor.fn_append_events(
    p_device  INT[],
    p_source  VARCHAR(12)[],
    p_kind    VARCHAR(24)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_state   SMALLINT[]
)
RETURNS void
LANGUAGE sql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
    INSERT INTO device_sensor.events (ts, device, source, kind, channel, state)
    SELECT
        to_timestamp(u._ts), u.device, u.source, u.kind, u.channel, u.state
    FROM unnest(p_device, p_source, p_kind, p_channel, p_ts, p_state)
         AS u(device, source, kind, channel, _ts, state);
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_sensor.fn_append_events(INT[], VARCHAR(12)[], VARCHAR(24)[], SMALLINT[], BIGINT[], SMALLINT[]);
