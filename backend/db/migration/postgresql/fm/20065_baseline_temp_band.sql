--------------UP
-- The temperature-adjusted sibling of fm.hour_of_week_baseline.
--
-- WHY THIS EXISTS: a 56-day window that crosses a shoulder season renders
-- seasonal drift as an anomaly. LBNL-63728 found explicit weather regression to
-- be the only model family that consistently avoids that bias.
--
-- WHY IT IS A BAND AND NOT A REGRESSION: at 168 bins a cell holds 8 weekly
-- observations, and a two-parameter fit on 8 points whose regressor barely
-- varies inside the bin is fitted to noise. At 48 bins a weekday cell holds
-- about 40, which is better and still unregularised. A band is a median of a
-- subset: same estimator, same 50% breakdown point, same contract as the
-- unadjusted table.
--
-- WHY THE BANDS ARE TERCILES OF THE WINDOW'S OWN SERIES: the family is the
-- ASHRAE bin method, and LBNL-4944E's TOWT bins temperature for the same
-- reason. What is NOT copied is the fixed balance point (CalTRACK and OpenDSM
-- at 65 F / 18.3 C, UK convention 15.5 C), because device_sensor.numeric_15min
-- stores each sensor's NATIVE unit and has no unit column. A fixed cut point
-- would silently misband every Fahrenheit sensor, the same wrong-clamp mistake
-- fn_baseline_value_ok already refuses.
--
-- SEPARATE TABLE, ON PURPOSE: a consumer must never mistake an adjusted number
-- for an unadjusted one. Different table, different read function, different
-- response field.
--
-- KNOWN LIMITATION, recorded rather than left to be found: in a thermally
-- stable window the three bands are three slices of the same weather. They cost
-- two thirds of the evidence and buy nothing. Nothing detects this for you;
-- band_min_val and band_max_val on every row are how you see it. And in a
-- shoulder season, the case this exists for, a band may occupy only the last
-- two weeks of the window and is therefore withheld by the week floor exactly
-- when it is wanted.
-- public only, everything schema-qualified; do not leak the schema to later migrations.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS fm.hour_of_week_baseline_temp (
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    scope_type      VARCHAR(16)  NOT NULL,
    device          INTEGER      NOT NULL,
    channel         SMALLINT     NOT NULL,
    tag             VARCHAR(30)  NOT NULL,
    -- Terciles of the window's own temperature series. Never absolute.
    temp_band       VARCHAR(4)   NOT NULL,
    hour_of_week    SMALLINT     NOT NULL,
    -- Coarse only. A 168-bin banded cell would hold 8/3 observations, so the
    -- CHECK refuses it rather than trusting everyone to remember why.
    bin_scheme      VARCHAR(16)  NOT NULL DEFAULT 'day_type_hour',
    p25_val         DOUBLE PRECISION NOT NULL,
    median_val      DOUBLE PRECISION NOT NULL,
    p75_val         DOUBLE PRECISION NOT NULL,
    sample_count    INTEGER      NOT NULL,
    weeks_observed  SMALLINT     NOT NULL,
    -- The band's cut points, in the sensor's native unit. Stored because a
    -- reader has to be able to see that the bands are a fraction of a degree
    -- apart and disregard them.
    band_min_val    DOUBLE PRECISION NOT NULL,
    band_max_val    DOUBLE PRECISION NOT NULL,
    -- Which device supplied the temperature, and from what kind of source.
    -- 'weather' is an Ecowitt-class station and is outdoors by construction;
    -- anything else is indoors, and an indoor temperature is partly an EFFECT
    -- of the load being modelled. The row says which so a consumer can refuse.
    temp_device     INTEGER      NOT NULL,
    temp_source     VARCHAR(12)  NOT NULL,
    first_seen_day  DATE         NOT NULL,
    window_from_day DATE         NOT NULL,
    excluded_days   SMALLINT     NOT NULL DEFAULT 0,
    timezone        VARCHAR(120) NOT NULL,
    window_days     SMALLINT     NOT NULL,
    computed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT hour_of_week_baseline_temp_pk PRIMARY KEY (
        organization_id, scope_type, device, channel, tag, temp_band, hour_of_week
    ),
    CONSTRAINT hour_of_week_baseline_temp_scope_chk CHECK (
        scope_type IN ('device', 'device_channel')
    ),
    CONSTRAINT hour_of_week_baseline_temp_band_name_chk CHECK (
        temp_band IN ('cool', 'mid', 'warm')
    ),
    CONSTRAINT hour_of_week_baseline_temp_hour_chk CHECK (
        hour_of_week BETWEEN 0 AND 167
    ),
    CONSTRAINT hour_of_week_baseline_temp_device_channel_chk CHECK (
        scope_type <> 'device' OR channel = 0
    ),
    CONSTRAINT hour_of_week_baseline_temp_counts_chk CHECK (
        sample_count > 0 AND weeks_observed > 0
    ),
    CONSTRAINT hour_of_week_baseline_temp_scheme_chk CHECK (
        bin_scheme = 'day_type_hour'
    ),
    CONSTRAINT hour_of_week_baseline_temp_quantile_chk CHECK (
        p25_val <= median_val AND median_val <= p75_val
    ),
    CONSTRAINT hour_of_week_baseline_temp_bounds_chk CHECK (
        band_min_val <= band_max_val
    ),
    CONSTRAINT hour_of_week_baseline_temp_window_chk CHECK (
        first_seen_day >= window_from_day AND excluded_days >= 0
    )
);

CREATE INDEX IF NOT EXISTS hour_of_week_baseline_temp_device_idx
    ON fm.hour_of_week_baseline_temp (organization_id, device);

COMMENT ON TABLE fm.hour_of_week_baseline_temp IS
    'Temperature-banded hour-of-week baseline, coarse bins only. A separate table from fm.hour_of_week_baseline so an adjusted number cannot be mistaken for an unadjusted one.';
COMMENT ON COLUMN fm.hour_of_week_baseline_temp.temp_source IS
    'weather = an outdoor station. Anything else is an indoor sensor, which is partly an effect of the load being modelled.';

-- Which temperature series serves an energy scope.
--
-- The link is the LOCATION, because organization.location_assignments is the
-- only relation in this codebase that says a sensor and a meter are in the same
-- place. A device assignment keys on device.list.id in device_id; subject_id is
-- NULL for subject_type 'device' and the table's own CHECK enforces that.
-- There is no room or zone model tying a sensor to a meter and none is
-- invented here.
--
-- Preference: an Ecowitt-class station outranks any other ambient sensor,
-- because 'weather' is the only source in this system that is outdoors by
-- construction. Ties break on the lowest device id so the choice is the same on
-- every run.
--
-- NO ANCESTOR WALK. A building-level station does not serve a floor-level
-- meter: how far up to walk is a modelling decision with a UI attached, and
-- this table has no other location-tree semantics. Same location only.
--
-- Returning ZERO rows is the normal outcome for most fleets and is not an
-- error. The caller writes no banded rows for that scope and says so in the
-- response.
CREATE OR REPLACE FUNCTION fm.fn_baseline_temperature_source(
    p_organization_id VARCHAR(120),
    p_device          INTEGER,
    -- Bounds the scan of the sensor rollup. Passed rather than derived so two
    -- runs over the same window resolve the same source.
    p_from            TIMESTAMPTZ
)
RETURNS TABLE (temp_device INTEGER, temp_source VARCHAR(12))
LANGUAGE sql STABLE
AS $$
    WITH me AS (
        SELECT la.location_id
          FROM organization.location_assignments la
         WHERE la.organization_id = p_organization_id
           AND la.subject_type    = 'device'
           AND la.device_id       = p_device
    ),
    neighbours AS (
        SELECT la2.device_id
          FROM me
          JOIN organization.location_assignments la2
            ON la2.organization_id = p_organization_id
           AND la2.subject_type    = 'device'
           AND la2.location_id     = me.location_id
    )
    SELECT n.device, n.source
      FROM neighbours nb
      JOIN LATERAL (
          SELECT DISTINCT nm.device, nm.source
            FROM device_sensor.numeric_15min nm
           WHERE nm.device  = nb.device_id
             AND nm.kind    = 'temperature'
             AND nm.source <> 'internal'
             AND nm.bucket >= p_from
      ) n ON TRUE
     ORDER BY (n.source = 'weather') DESC, n.device
     LIMIT 1;
$$;

-- Rebuild one organization's temperature-banded baseline for a batch of
-- devices. Same window, same exclusions, same value rule, same change gate as
-- fm.fn_rebuild_hour_of_week_baseline; only the binning differs, and only in
-- that a temperature band joins day-type and hour.
CREATE OR REPLACE FUNCTION fm.fn_rebuild_baseline_temp_bands(
    p_organization_id VARCHAR(120),
    p_devices         INTEGER[],
    p_energy_tags     VARCHAR(30)[],
    p_sensor_kinds    VARCHAR(24)[],
    p_include_power   BOOLEAN,
    p_tz              TEXT,
    p_window_days     INTEGER,
    p_weekend_dows    SMALLINT[],
    p_now             TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_owned    INTEGER[];
    v_from     TIMESTAMPTZ;
    v_to       TIMESTAMPTZ;
    v_from_day DATE;
    v_to_day   DATE;
    v_excluded INTEGER;
    v_rows     INTEGER;
BEGIN
    -- Tenancy in SQL, not in the caller.
    SELECT COALESCE(array_agg(l.id), ARRAY[]::INTEGER[])
      INTO v_owned
      FROM device.list l
     WHERE l.id = ANY(p_devices)
       AND l.organization_id = p_organization_id;

    IF COALESCE(array_length(v_owned, 1), 0) = 0 THEN
        RETURN 0;
    END IF;

    v_to       := date_trunc('day', p_now AT TIME ZONE p_tz) AT TIME ZONE p_tz;
    v_from     := v_to - make_interval(days => p_window_days);
    v_from_day := (v_from AT TIME ZONE p_tz)::DATE;
    v_to_day   := (v_to   AT TIME ZONE p_tz)::DATE;

    SELECT COUNT(*)
      INTO v_excluded
      FROM fm.fn_baseline_excluded_days(p_organization_id, v_from_day, v_to_day);

    DELETE FROM fm.hour_of_week_baseline_temp b
     WHERE b.organization_id = p_organization_id
       AND b.device = ANY(v_owned);

    INSERT INTO fm.hour_of_week_baseline_temp (
        organization_id, scope_type, device, channel, tag, temp_band,
        hour_of_week, bin_scheme, p25_val, median_val, p75_val,
        sample_count, weeks_observed, band_min_val, band_max_val,
        temp_device, temp_source, first_seen_day, window_from_day,
        excluded_days, timezone, window_days, computed_at
    )
    WITH excluded AS (
        SELECT x.excluded_day
          FROM fm.fn_baseline_excluded_days(
                   p_organization_id, v_from_day, v_to_day) x
    ),
    change_gate AS (
        SELECT c.scope_type, c.device, c.channel, c.tag,
               (c.changed_on::TIMESTAMP AT TIME ZONE p_tz) AS changed_ts
          FROM fm.baseline_change_point c
         WHERE c.organization_id = p_organization_id
           AND c.device = ANY(v_owned)
           AND c.state = 'alarm'
           AND c.changed_on > v_from_day
    ),
    -- One temperature series per energy device, resolved by location.
    -- A device with none simply produces no rows below.
    linked AS (
        SELECT d.id AS device, s.temp_device, s.temp_source
          FROM unnest(v_owned) AS d(id)
          CROSS JOIN LATERAL fm.fn_baseline_temperature_source(
                                 p_organization_id, d.id, v_from) s
    ),
    -- The bucket-level temperature of each linked series. Channels collapse
    -- into ONE series on purpose: several probes under one station are one
    -- ambient reading. The unadjusted rebuild keeps channel instead, because
    -- there each channel is its own scope.
    temp_series AS (
        SELECT l.device                          AS scope_device,
               l.temp_device,
               l.temp_source,
               n.bucket,
               SUM(n.sum_val) / NULLIF(SUM(n.sample_count), 0) AS temp_val
          FROM linked l
          JOIN device_sensor.numeric_15min n
            ON n.device  = l.temp_device
           AND n.source  = l.temp_source
           AND n.kind    = 'temperature'
           AND n.bucket >= v_from
           AND n.bucket <  v_to
           AND n.sample_count > 0
         GROUP BY l.device, l.temp_device, l.temp_source, n.bucket
    ),
    -- Terciles of the window's OWN distribution. No unit is assumed anywhere.
    cuts AS (
        SELECT t.scope_device,
               (percentile_cont(ARRAY[0.3333, 0.6667])
                    WITHIN GROUP (ORDER BY t.temp_val)) AS q,
               MIN(t.temp_val) AS lo,
               MAX(t.temp_val) AS hi
          FROM temp_series t
         GROUP BY t.scope_device
    ),
    banded_buckets AS (
        SELECT t.scope_device,
               t.temp_device,
               t.temp_source,
               t.bucket,
               (CASE
                    WHEN t.temp_val <  c.q[1] THEN 'cool'
                    WHEN t.temp_val >= c.q[2] THEN 'warm'
                    ELSE 'mid'
                END)::VARCHAR(4) AS temp_band,
               (CASE
                    WHEN t.temp_val <  c.q[1] THEN c.lo
                    WHEN t.temp_val >= c.q[2] THEN c.q[2]
                    ELSE c.q[1]
                END) AS band_min_val,
               (CASE
                    WHEN t.temp_val <  c.q[1] THEN c.q[1]
                    WHEN t.temp_val >= c.q[2] THEN c.hi
                    ELSE c.q[2]
                END) AS band_max_val
          FROM temp_series t
          JOIN cuts c ON c.scope_device = t.scope_device
    ),
    samples AS (
        SELECT fm.fn_baseline_scope_type(e.tag) AS scope_type,
               e.device                          AS device,
               COALESCE(e.channel, 0)::SMALLINT  AS channel,
               e.tag                             AS tag,
               e.bucket                          AS bucket,
               e.energy_wh                       AS val,
               GREATEST(v_from, COALESCE(cg.changed_ts, v_from)) AS win_from
          FROM device_em.fn_report_energy_15min_by_channel(
                   v_owned, v_from, v_to, p_energy_tags) e
          LEFT JOIN change_gate cg
                 ON cg.scope_type = 'device_channel'
                AND cg.device     = e.device
                AND cg.channel    = COALESCE(e.channel, 0)::SMALLINT
                AND cg.tag        = e.tag
         WHERE e.bucket >= GREATEST(v_from, COALESCE(cg.changed_ts, v_from))

        UNION ALL

        -- Power still comes through the SSOT ladder. A per-phase average here
        -- would read a three-phase meter a third low, banded or not.
        SELECT fm.fn_baseline_scope_type('power'),
               p.device,
               0::SMALLINT,
               'power'::VARCHAR(30),
               p.bucket,
               p.avg_w,
               GREATEST(v_from, COALESCE(pcg.changed_ts, v_from))
          FROM device_em.fn_device_power_avg(
                   v_owned, v_from, v_to, '15 minutes') p
          LEFT JOIN change_gate pcg
                 ON pcg.scope_type = 'device'
                AND pcg.device     = p.device
                AND pcg.channel    = 0
                AND pcg.tag        = 'power'
         WHERE p_include_power
           AND p.bucket >= GREATEST(v_from, COALESCE(pcg.changed_ts, v_from))

        UNION ALL

        SELECT fm.fn_baseline_scope_type(n.kind::VARCHAR(30)),
               n.device,
               COALESCE(n.channel, 0)::SMALLINT,
               n.kind::VARCHAR(30),
               n.bucket,
               SUM(n.sum_val) / NULLIF(SUM(n.sample_count), 0),
               GREATEST(v_from, COALESCE(scg.changed_ts, v_from))
          FROM device_sensor.numeric_15min n
          LEFT JOIN change_gate scg
                 ON scg.scope_type = 'device_channel'
                AND scg.device     = n.device
                AND scg.channel    = COALESCE(n.channel, 0)::SMALLINT
                AND scg.tag        = n.kind::VARCHAR(30)
         WHERE n.device = ANY(v_owned)
           AND n.bucket >= GREATEST(v_from, COALESCE(scg.changed_ts, v_from))
           AND n.bucket <  v_to
           AND n.source <> 'internal'
           AND n.kind = ANY(p_sensor_kinds)
           AND n.sample_count > 0
         GROUP BY n.device, COALESCE(n.channel, 0), n.kind, n.bucket,
                  GREATEST(v_from, COALESCE(scg.changed_ts, v_from))
    ),
    kept AS (
        SELECT s.scope_type, s.device, s.channel, s.tag, s.val, s.win_from,
               s.bucket,
               (s.bucket AT TIME ZONE p_tz) AS local_ts
          FROM samples s
         WHERE s.val IS NOT NULL
           AND fm.fn_baseline_value_ok(s.tag, s.val)
    ),
    -- The inner join is what makes "no temperature source" mean "no rows".
    -- A bucket with no banded temperature contributes to nothing.
    filtered AS (
        SELECT k.scope_type, k.device, k.channel, k.tag, k.val, k.win_from,
               k.local_ts,
               b.temp_band, b.band_min_val, b.band_max_val,
               b.temp_device, b.temp_source,
               fm.fn_baseline_day_type(
                   EXTRACT(DOW FROM k.local_ts)::INTEGER, p_weekend_dows
               )::INTEGER * 24 + EXTRACT(HOUR FROM k.local_ts)::INTEGER AS bin
          FROM kept k
          JOIN banded_buckets b
            ON b.scope_device = k.device
           AND b.bucket       = k.bucket
         WHERE NOT EXISTS (
                   SELECT 1 FROM excluded x
                    WHERE x.excluded_day = k.local_ts::DATE
               )
    ),
    agg AS (
        SELECT f.scope_type, f.device, f.channel, f.tag, f.temp_band, f.bin,
               MIN(f.band_min_val) AS band_min_val,
               MAX(f.band_max_val) AS band_max_val,
               MIN(f.temp_device)  AS temp_device,
               MIN(f.temp_source)  AS temp_source,
               percentile_cont(ARRAY[0.25, 0.5, 0.75])
                   WITHIN GROUP (ORDER BY f.val) AS q,
               COUNT(*)::INTEGER AS sample_count,
               COUNT(DISTINCT date_trunc('week', f.local_ts))::SMALLINT
                   AS weeks_observed,
               MIN(f.local_ts)::DATE AS first_seen_day,
               (MIN(f.win_from) AT TIME ZONE p_tz)::DATE AS window_from_day
          FROM filtered f
         GROUP BY f.scope_type, f.device, f.channel, f.tag, f.temp_band, f.bin
    )
    -- Fan a coarse bin out to every hour it covers, so no reader has to know
    -- which day-type produced it.
    SELECT p_organization_id,
           a.scope_type,
           a.device,
           a.channel,
           a.tag,
           a.temp_band,
           h.hour_of_week::SMALLINT,
           'day_type_hour'::VARCHAR(16),
           a.q[1], a.q[2], a.q[3],
           a.sample_count,
           a.weeks_observed,
           a.band_min_val,
           a.band_max_val,
           a.temp_device,
           a.temp_source,
           a.first_seen_day,
           a.window_from_day,
           v_excluded::SMALLINT,
           p_tz,
           p_window_days::SMALLINT,
           p_now
      FROM agg a
      JOIN generate_series(0, 167) AS h(hour_of_week)
        ON a.bin = fm.fn_baseline_day_type(
                       h.hour_of_week / 24, p_weekend_dows)::INTEGER * 24
                   + (h.hour_of_week % 24);

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- The read path for the banded table. Same gate as the unadjusted read: a cell
-- below the week floor returns all three quantiles NULL. p_band NULL returns
-- every band, so one call can populate a band picker.
CREATE OR REPLACE FUNCTION fm.fn_baseline_temp_bands(
    p_organization_id VARCHAR(120),
    p_device          INTEGER,
    p_channel         SMALLINT,
    p_tag             VARCHAR(30),
    p_band            VARCHAR(4),
    p_min_weeks       INTEGER
)
RETURNS TABLE (
    temp_band       VARCHAR(4),
    hour_of_week    SMALLINT,
    bin_scheme      VARCHAR(16),
    p25_val         DOUBLE PRECISION,
    median_val      DOUBLE PRECISION,
    p75_val         DOUBLE PRECISION,
    sample_count    INTEGER,
    weeks_observed  SMALLINT,
    band_min_val    DOUBLE PRECISION,
    band_max_val    DOUBLE PRECISION,
    temp_device     INTEGER,
    temp_source     VARCHAR(12),
    first_seen_day  DATE,
    window_from_day DATE,
    excluded_days   SMALLINT,
    ready           BOOLEAN,
    timezone        VARCHAR(120),
    computed_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT b.temp_band,
           b.hour_of_week,
           b.bin_scheme,
           CASE WHEN b.weeks_observed >= p_min_weeks THEN b.p25_val END,
           CASE WHEN b.weeks_observed >= p_min_weeks THEN b.median_val END,
           CASE WHEN b.weeks_observed >= p_min_weeks THEN b.p75_val END,
           b.sample_count,
           b.weeks_observed,
           -- Never gated. The cut points are how a reader sees that three bands
           -- half a degree apart are three slices of the same weather.
           b.band_min_val,
           b.band_max_val,
           b.temp_device,
           b.temp_source,
           b.first_seen_day,
           b.window_from_day,
           b.excluded_days,
           b.weeks_observed >= p_min_weeks,
           b.timezone,
           b.computed_at
      FROM fm.hour_of_week_baseline_temp b
     WHERE b.organization_id = p_organization_id
       AND b.device          = p_device
       AND b.tag             = p_tag
       AND b.scope_type      = fm.fn_baseline_scope_type(p_tag)
       AND b.channel = CASE
               WHEN fm.fn_baseline_scope_type(p_tag) = 'device' THEN 0::SMALLINT
               ELSE p_channel
           END
       AND (p_band IS NULL OR b.temp_band = p_band)
     ORDER BY b.temp_band, b.hour_of_week;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_baseline_temp_bands(
    VARCHAR, INTEGER, SMALLINT, VARCHAR, VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS fm.fn_rebuild_baseline_temp_bands(
    VARCHAR, INTEGER[], VARCHAR[], VARCHAR[], BOOLEAN, TEXT, INTEGER,
    SMALLINT[], TIMESTAMPTZ);
DROP FUNCTION IF EXISTS fm.fn_baseline_temperature_source(
    VARCHAR, INTEGER, TIMESTAMPTZ);
DROP TABLE IF EXISTS fm.hour_of_week_baseline_temp;
