--------------UP
SET search_path TO organization, public;

-- Price-over-time history for live tariffs. One row per (tariff, timestamp);
-- prices may be negative (e.g. surplus export on spot markets).
CREATE TABLE organization.tariff_live_price (
    tariff_id  INTEGER           NOT NULL,
    ts         TIMESTAMPTZ       NOT NULL,
    price      DOUBLE PRECISION  NOT NULL
);

SELECT create_hypertable('organization.tariff_live_price', 'ts', chunk_time_interval => INTERVAL '30 days');

-- Unique key drives ON CONFLICT idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_live_price_key
    ON organization.tariff_live_price (tariff_id, ts);

-- Fast "latest price at/before ts" lookups.
CREATE INDEX IF NOT EXISTS organization__tariff_live_price_desc
    ON organization.tariff_live_price (tariff_id, ts DESC);

-- One row per live-mode tariff: delivery mode + optional pull-provider config.
CREATE TABLE organization.tariff_live_source (
    tariff_id         INTEGER PRIMARY KEY
                        REFERENCES organization.tariff(id) ON DELETE CASCADE,
    mode              VARCHAR(8)   NOT NULL CHECK (mode IN ('push','pull')),
    provider          VARCHAR(32),
    push_token_hash   VARCHAR(128),
    provider_config   JSONB,
    created           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated           TIMESTAMPTZ
);

-- Append or overwrite a single price point (epoch-seconds → timestamptz).
CREATE OR REPLACE FUNCTION organization.fn_tariff_live_append(
    p_tariff_id INT,
    p_ts        BIGINT,
    p_price     DOUBLE PRECISION
) RETURNS void
LANGUAGE sql
AS $$
    INSERT INTO organization.tariff_live_price (tariff_id, ts, price)
    VALUES (p_tariff_id, to_timestamp(p_ts), p_price)
    ON CONFLICT (tariff_id, ts) DO UPDATE SET price = EXCLUDED.price;
$$;

-- Return all prices in [p_from, p_to) plus the single most-recent price
-- strictly before p_from, so a billing pass can price the first open bucket.
CREATE OR REPLACE FUNCTION organization.fn_tariff_live_prices(
    p_tariff_id INT,
    p_from      TIMESTAMPTZ,
    p_to        TIMESTAMPTZ
) RETURNS TABLE(ts TIMESTAMPTZ, price DOUBLE PRECISION)
LANGUAGE sql STABLE
AS $$
    (
        SELECT ts, price
        FROM   organization.tariff_live_price
        WHERE  tariff_id = p_tariff_id
          AND  ts < p_from
        ORDER  BY ts DESC
        LIMIT  1
    )
    UNION ALL
    (
        SELECT ts, price
        FROM   organization.tariff_live_price
        WHERE  tariff_id = p_tariff_id
          AND  ts >= p_from
          AND  ts < p_to
        ORDER  BY ts
    )
    ORDER BY ts;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_live_prices(INT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS organization.fn_tariff_live_append(INT, BIGINT, DOUBLE PRECISION);
DROP TABLE IF EXISTS organization.tariff_live_source;
DROP TABLE IF EXISTS organization.tariff_live_price;
