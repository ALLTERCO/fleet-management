--------------UP
-- One nightly-computed notion of "normal": p25 / median / p75 per
-- (scope, tag, hour of the local week), plus the evidence behind it.
-- Median and IQR, not mean and sigma: the mean has breakdown point 0, so one
-- bad value moves it without bound, and this is what spikes are measured against.
-- A band, not just a centre, so no consumer invents its own threshold.
-- Hour of the LOCAL week: a shop's Sunday 03:00 and Monday 09:00 share nothing.
-- Not a hypertable: 168 rows per (scope, tag) is a lookup table.
-- Lives in fm because rows come from both the energy and the sensor rollups.
-- public only, everything schema-qualified; do not leak the schema to later migrations.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS fm.hour_of_week_baseline (
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    -- device_channel is the finest addressable energy identity; device is power only.
    scope_type      VARCHAR(16)  NOT NULL,
    device          INTEGER      NOT NULL,
    channel         SMALLINT     NOT NULL,
    tag             VARCHAR(30)  NOT NULL,
    -- EXTRACT(DOW) * 24 + EXTRACT(HOUR), local wall clock, DOW 0 = Sunday.
    hour_of_week    SMALLINT     NOT NULL,
    -- day_type_hour = 48 pooled bins fanned out; hour_of_week = 168 bins once the window is full.
    bin_scheme      VARCHAR(16)  NOT NULL,
    -- All three come from one percentile_cont(ARRAY[...]) sort.
    p25_val         DOUBLE PRECISION NOT NULL,
    median_val      DOUBLE PRECISION NOT NULL,
    p75_val         DOUBLE PRECISION NOT NULL,
    -- 15-minute buckets that contributed; not the evidence measure.
    sample_count    INTEGER      NOT NULL,
    -- The sufficiency measure: eight buckets from one week is still one week.
    weeks_observed  SMALLINT     NOT NULL,
    first_seen_day  DATE         NOT NULL,
    -- Effective window start; a counter reset inside the window moves it forward.
    window_from_day DATE         NOT NULL,
    -- Local days the operator excluded from this window.
    excluded_days   SMALLINT     NOT NULL DEFAULT 0,
    -- Stored, not assumed, so a changed org zone rebuilds instead of reinterpreting.
    timezone        VARCHAR(120) NOT NULL,
    window_days     SMALLINT     NOT NULL,
    computed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT hour_of_week_baseline_pk PRIMARY KEY (
        organization_id, scope_type, device, channel, tag, hour_of_week
    ),
    CONSTRAINT hour_of_week_baseline_scope_chk CHECK (
        scope_type IN ('device', 'device_channel')
    ),
    CONSTRAINT hour_of_week_baseline_hour_chk CHECK (
        hour_of_week BETWEEN 0 AND 167
    ),
    -- Device grain has no channel; pinning it to 0 keeps every key column NOT NULL.
    CONSTRAINT hour_of_week_baseline_device_channel_chk CHECK (
        scope_type <> 'device' OR channel = 0
    ),
    -- A cell that claims no evidence is a writer bug, not a valid row.
    CONSTRAINT hour_of_week_baseline_counts_chk CHECK (
        sample_count > 0 AND weeks_observed > 0
    ),
    CONSTRAINT hour_of_week_baseline_scheme_chk CHECK (
        bin_scheme IN ('day_type_hour', 'hour_of_week')
    ),
    -- Quantiles from one sorted pass are ordered by construction; firing means the aggregate is wrong.
    CONSTRAINT hour_of_week_baseline_band_chk CHECK (
        p25_val <= median_val AND median_val <= p75_val
    ),
    -- A truncated window only moves the start forward, never behind the first contributing day.
    CONSTRAINT hour_of_week_baseline_window_chk CHECK (
        first_seen_day >= window_from_day AND excluded_days >= 0
    )
);

-- The nightly rebuild deletes and rewrites one device batch at a time.
CREATE INDEX IF NOT EXISTS hour_of_week_baseline_device_idx
    ON fm.hour_of_week_baseline (organization_id, device);

COMMENT ON TABLE fm.hour_of_week_baseline IS
    'p25/median/p75 per (scope, tag, hour of the local week), the one durable notion of normal. Operational signal only: NOT an M&V or settlement baseline.';
COMMENT ON COLUMN fm.hour_of_week_baseline.weeks_observed IS
    'Distinct local weeks behind this cell. The sufficiency gate keys on this, never on sample_count.';
COMMENT ON COLUMN fm.hour_of_week_baseline.bin_scheme IS
    'day_type_hour (48 bins, pooled) until the window is full, then hour_of_week (168). Pooling is the mitigation for 168 unregularised bins on 8 weekly observations.';
COMMENT ON COLUMN fm.hour_of_week_baseline.window_from_day IS
    'Effective window start. Later than the nominal start when a counter reset truncated it; a replacement meter is a different asset.';

-- The tag to grain rule in one place, so the rebuild and the read never disagree.
-- Mirrored in TypeScript by baselineScopeType().
CREATE OR REPLACE FUNCTION fm.fn_baseline_scope_type(p_tag VARCHAR)
RETURNS VARCHAR(16)
LANGUAGE sql IMMUTABLE
AS $$
    SELECT (CASE WHEN p_tag = 'power' THEN 'device' ELSE 'device_channel' END)::VARCHAR(16);
$$;

-- The coarse-bin rule: 0 = working day, 1 = weekend; coarse bin = day_type * 24 + hour.
-- The weekend set is a parameter because Saturday/Sunday is wrong for a Friday/Saturday weekend.
CREATE OR REPLACE FUNCTION fm.fn_baseline_day_type(
    p_dow           INTEGER,
    p_weekend_dows  SMALLINT[]
)
RETURNS SMALLINT
LANGUAGE sql IMMUTABLE
AS $$
    SELECT (CASE WHEN p_dow::SMALLINT = ANY(p_weekend_dows) THEN 1 ELSE 0 END)::SMALLINT;
$$;

-- The physical-range rule: a value that cannot exist must not reach the sort.
-- Only physics that holds in every unit is encoded; the sensor rollup stores
-- native units with no unit column, so a temperature or pressure clamp would
-- silently delete Fahrenheit or Pa data.
-- Mirrored in TypeScript by baselineValueOk().
CREATE OR REPLACE FUNCTION fm.fn_baseline_value_ok(
    p_tag VARCHAR,
    p_val DOUBLE PRECISION
)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
    SELECT p_val IS NOT NULL
       -- In PostgreSQL NaN = NaN is TRUE, so <> 'NaN' rejects it.
       AND p_val <> 'NaN'::DOUBLE PRECISION
       AND p_val <> 'Infinity'::DOUBLE PRECISION
       AND p_val <> '-Infinity'::DOUBLE PRECISION
       AND CASE
               -- Deltas of a monotonic counter cannot be negative in any unit.
               WHEN p_tag IN ('total_act_energy', 'total_act_ret_energy',
                              'volume_l', 'volume_m3', 'thermal_energy_kwh')
                   THEN p_val >= 0
               -- Percent in the only source that defines them (BTHome objects 3 and 20).
               WHEN p_tag IN ('humidity', 'moisture')
                   THEN p_val >= 0 AND p_val <= 100
               -- Everything else, including power: an exporting site reads negative power.
               ELSE TRUE
           END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_baseline_value_ok(VARCHAR, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS fm.fn_baseline_day_type(INTEGER, SMALLINT[]);
DROP FUNCTION IF EXISTS fm.fn_baseline_scope_type(VARCHAR);
DROP TABLE IF EXISTS fm.hour_of_week_baseline;
