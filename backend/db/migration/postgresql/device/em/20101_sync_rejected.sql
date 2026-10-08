-- Meter blocks PostgreSQL rejects are kept here with the reason, so a gap
-- is visible and can be queued again on purpose. Nothing is dropped.
--------------UP

CREATE TABLE IF NOT EXISTS device_em.sync_rejected (
    id           BIGSERIAL PRIMARY KEY,
    device       INT NOT NULL,
    channel      SMALLINT NOT NULL,
    cursor_created BIGINT NOT NULL,
    row_count    INT NOT NULL,
    first_ts     BIGINT,
    last_ts      BIGINT,
    sqlstate     VARCHAR(5),
    message      TEXT NOT NULL,
    block        JSONB NOT NULL,
    rejected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    requeued_at  TIMESTAMPTZ,
    requeued_by  VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS sync_rejected_open
    ON device_em.sync_rejected (device, channel, rejected_at)
    WHERE requeued_at IS NULL;

CREATE OR REPLACE FUNCTION device_em.fn_sync_rejected_add(
    p_device INT,
    p_channel SMALLINT,
    p_cursor_created BIGINT,
    p_row_count INT,
    p_first_ts BIGINT,
    p_last_ts BIGINT,
    p_sqlstate VARCHAR(5),
    p_message TEXT,
    p_block JSONB
)
RETURNS BIGINT
LANGUAGE sql
AS
$$
    INSERT INTO device_em.sync_rejected
        (device, channel, cursor_created, row_count, first_ts, last_ts,
         sqlstate, message, block)
    VALUES
        (p_device, p_channel, p_cursor_created, p_row_count, p_first_ts,
         p_last_ts, p_sqlstate, p_message, p_block)
    RETURNING id;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_sync_rejected_list(
    p_devices INT[],
    p_open_only BOOLEAN,
    p_limit INT
)
RETURNS TABLE (
    id BIGINT,
    device INT,
    channel SMALLINT,
    cursor_created BIGINT,
    row_count INT,
    first_ts BIGINT,
    last_ts BIGINT,
    sqlstate VARCHAR(5),
    message TEXT,
    rejected_at TIMESTAMPTZ,
    requeued_at TIMESTAMPTZ,
    requeued_by VARCHAR(255)
)
LANGUAGE sql
STABLE
AS
$$
    SELECT r.id, r.device, r.channel, r.cursor_created, r.row_count,
           r.first_ts, r.last_ts, r.sqlstate, r.message, r.rejected_at,
           r.requeued_at, r.requeued_by
    FROM device_em.sync_rejected r
    WHERE r.device = ANY(p_devices)
      AND (NOT p_open_only OR r.requeued_at IS NULL)
    ORDER BY r.rejected_at DESC, r.id DESC
    LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

CREATE OR REPLACE FUNCTION device_em.fn_sync_rejected_open_count(
    p_devices INT[]
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS
$$
    SELECT count(*)
    FROM device_em.sync_rejected r
    WHERE r.device = ANY(p_devices)
      AND r.requeued_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_sync_rejected_get(
    p_id BIGINT,
    p_devices INT[]
)
RETURNS TABLE (
    id BIGINT,
    device INT,
    channel SMALLINT,
    cursor_created BIGINT,
    block JSONB
)
LANGUAGE sql
STABLE
AS
$$
    SELECT r.id, r.device, r.channel, r.cursor_created, r.block
    FROM device_em.sync_rejected r
    WHERE r.id = p_id
      AND r.device = ANY(p_devices)
      AND r.requeued_at IS NULL;
$$;

-- Marks one open row as queued again and returns its block. A second call
-- for the same row returns nothing, so a block is queued once per decision.
CREATE OR REPLACE FUNCTION device_em.fn_sync_rejected_take(
    p_id BIGINT,
    p_devices INT[],
    p_by VARCHAR(255)
)
RETURNS TABLE (
    id BIGINT,
    device INT,
    channel SMALLINT,
    cursor_created BIGINT,
    block JSONB
)
LANGUAGE sql
AS
$$
    UPDATE device_em.sync_rejected r
    SET requeued_at = now(), requeued_by = p_by
    WHERE r.id = p_id
      AND r.device = ANY(p_devices)
      AND r.requeued_at IS NULL
    RETURNING r.id, r.device, r.channel, r.cursor_created, r.block;
$$;

--------------DOWN

DROP FUNCTION IF EXISTS device_em.fn_sync_rejected_take(BIGINT, INT[], VARCHAR);
DROP FUNCTION IF EXISTS device_em.fn_sync_rejected_get(BIGINT, INT[]);
DROP FUNCTION IF EXISTS device_em.fn_sync_rejected_open_count(INT[]);
DROP FUNCTION IF EXISTS device_em.fn_sync_rejected_list(INT[], BOOLEAN, INT);
DROP FUNCTION IF EXISTS device_em.fn_sync_rejected_add(INT, SMALLINT, BIGINT, INT, BIGINT, BIGINT, VARCHAR, TEXT, JSONB);
DROP INDEX IF EXISTS device_em.sync_rejected_open;
DROP TABLE IF EXISTS device_em.sync_rejected;
