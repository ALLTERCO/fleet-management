--------------UP
-- Level-shift detection for the hour-of-week baseline.
--
-- A fixed trailing window absorbs a real step change over about eight weeks and
-- then flags the RECOVERY as the anomaly. That is Datadog's documented `agile`
-- failure mode, and this baseline takes the fast-adapting side on purpose, so
-- this is the thing that catches the case where that choice is wrong.
--
-- The literature agrees on the shape: watch the RESIDUAL, not the level. EVO's
-- IPMVP materials name CUSUM for non-routine event detection and LBNL ships an
-- `nre` package whose detector is a statistical change-point algorithm; the ML
-- drift literature adds DDM's two-stage warning-then-alarm and ADWIN's
-- self-shrinking window. All three ideas are used below.
--
-- The residual exists because the rebuild runs nightly against a window that
-- ends at the previous local midnight. Scoring today's observations against
-- last night's baseline is out-of-sample by exactly one night, and it needs no
-- consumer of the API to exist.
--
-- public only, everything schema-qualified, so the schema is not leaked to the
-- next migration in the shared session search_path.
SET search_path TO public;

-- One standardised number per series per local day. Bounded: the detector
-- purges anything older than its lookback, which the caller sets to the
-- baseline window so a change point cannot outlive the window it truncates.
CREATE TABLE IF NOT EXISTS fm.baseline_residual_day (
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    scope_type      VARCHAR(16)  NOT NULL,
    device          INTEGER      NOT NULL,
    channel         SMALLINT     NOT NULL,
    tag             VARCHAR(30)  NOT NULL,
    local_day       DATE         NOT NULL,
    -- Median over the day of (observed - median_val) / ((p75_val - p25_val)/1.349).
    -- The divisor is the normal-consistent robust scale the baseline already
    -- stores, so this adds no new statistic and no new knob. Median of the
    -- day's values, not mean, for the same breakdown point.
    z_median        DOUBLE PRECISION NOT NULL,
    -- How many 15-minute buckets scored. Reported, never used as the gate:
    -- buckets inside a day are not independent evidence about that day.
    bucket_count    INTEGER      NOT NULL,
    computed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT baseline_residual_day_pk PRIMARY KEY (
        organization_id, scope_type, device, channel, tag, local_day
    ),
    CONSTRAINT baseline_residual_day_scope_chk CHECK (
        scope_type IN ('device', 'device_channel')
    ),
    CONSTRAINT baseline_residual_day_buckets_chk CHECK (bucket_count > 0)
);

CREATE INDEX IF NOT EXISTS baseline_residual_day_device_idx
    ON fm.baseline_residual_day (organization_id, device, local_day);

COMMENT ON TABLE fm.baseline_residual_day IS
    'One standardised daily residual per baseline series: the input to the CUSUM change-point detector.';

-- At most one live change point per series. Two states, DDM's shape: a warning
-- is recorded and reported, an alarm additionally shrinks the rebuild window.
CREATE TABLE IF NOT EXISTS fm.baseline_change_point (
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    scope_type      VARCHAR(16)  NOT NULL,
    device          INTEGER      NOT NULL,
    channel         SMALLINT     NOT NULL,
    tag             VARCHAR(30)  NOT NULL,
    -- 'warning' -> reported, nothing else. DDM's point is that a warning is
    --              where you start watching, not where you act.
    -- 'alarm'   -> the rebuild truncates this series' window to changed_on.
    state           VARCHAR(8)   NOT NULL,
    direction       VARCHAR(4)   NOT NULL,
    -- The day the new regime is estimated to start: the day after the last day
    -- the crossing arm sat at zero. That is the standard tabular-CUSUM
    -- change-point estimate.
    changed_on      DATE         NOT NULL,
    cusum_value     DOUBLE PRECISION NOT NULL,
    residual_days   INTEGER      NOT NULL,
    detected_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT baseline_change_point_pk PRIMARY KEY (
        organization_id, scope_type, device, channel, tag
    ),
    CONSTRAINT baseline_change_point_scope_chk CHECK (
        scope_type IN ('device', 'device_channel')
    ),
    CONSTRAINT baseline_change_point_state_chk CHECK (
        state IN ('warning', 'alarm')
    ),
    CONSTRAINT baseline_change_point_direction_chk CHECK (
        direction IN ('up', 'down')
    ),
    CONSTRAINT baseline_change_point_cusum_chk CHECK (cusum_value > 0)
);

CREATE INDEX IF NOT EXISTS baseline_change_point_device_idx
    ON fm.baseline_change_point (organization_id, device);

COMMENT ON COLUMN fm.baseline_change_point.state IS
    'alarm truncates the rebuild window to changed_on, which drops weeks_observed under the sufficiency floor so the existing read gate refuses to compare. warning is reported only.';

-- Score one or a few days of observations against the baseline as it stands
-- RIGHT NOW, i.e. before tonight's rebuild replaces it.
--
-- The three readers below are the same three the rebuild uses, for the same
-- reasons: power must come through fn_device_power_avg or a three-phase
-- meter reads a third low, and source='internal' is chip temperature and never
-- the room. They are spelled out twice because SQL cannot share a CTE across
-- two statements and folding this into the rebuild would score an observation
-- against a baseline that already contains it. The duplication is the cheaper
-- mistake, and the integration tests pin both readers against one fixture.
CREATE OR REPLACE FUNCTION fm.fn_baseline_record_residuals(
    p_organization_id VARCHAR(120),
    p_devices         INTEGER[],
    p_energy_tags     VARCHAR(30)[],
    p_sensor_kinds    VARCHAR(24)[],
    p_include_power   BOOLEAN,
    p_tz              TEXT,
    -- Complete local days to score. More than one so a missed night is caught up.
    p_days            INTEGER,
    p_min_weeks       INTEGER,
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
    v_rows     INTEGER;
BEGIN
    -- Tenancy in SQL, not in the caller, exactly as the rebuild does it.
    SELECT COALESCE(array_agg(l.id), ARRAY[]::INTEGER[])
      INTO v_owned
      FROM device.list l
     WHERE l.id = ANY(p_devices)
       AND l.organization_id = p_organization_id;

    IF COALESCE(array_length(v_owned, 1), 0) = 0 THEN
        RETURN 0;
    END IF;

    -- Complete local days only. A partially collected day would score low for
    -- a reason that has nothing to do with the site.
    v_to       := date_trunc('day', p_now AT TIME ZONE p_tz) AT TIME ZONE p_tz;
    v_from     := v_to - make_interval(days => p_days);
    v_from_day := (v_from AT TIME ZONE p_tz)::DATE;
    v_to_day   := (v_to   AT TIME ZONE p_tz)::DATE;

    INSERT INTO fm.baseline_residual_day (
        organization_id, scope_type, device, channel, tag, local_day,
        z_median, bucket_count, computed_at
    )
    WITH excluded AS (
        SELECT x.excluded_day
          FROM fm.fn_baseline_excluded_days(
                   p_organization_id, v_from_day, v_to_day) x
    ),
    samples AS (
        SELECT fm.fn_baseline_scope_type(e.tag) AS scope_type,
               e.device                          AS device,
               COALESCE(e.channel, 0)::SMALLINT  AS channel,
               e.tag                             AS tag,
               e.bucket                          AS bucket,
               e.energy_wh                       AS val
          FROM device_em.fn_report_energy_15min_by_channel(
                   v_owned, v_from, v_to, p_energy_tags) e

        UNION ALL

        SELECT fm.fn_baseline_scope_type('power'),
               p.device,
               0::SMALLINT,
               'power'::VARCHAR(30),
               p.bucket,
               p.avg_w
          FROM device_em.fn_device_power_avg(
                   v_owned, v_from, v_to, '15 minutes') p
         WHERE p_include_power

        UNION ALL

        SELECT fm.fn_baseline_scope_type(n.kind::VARCHAR(30)),
               n.device,
               COALESCE(n.channel, 0)::SMALLINT,
               n.kind::VARCHAR(30),
               n.bucket,
               SUM(n.sum_val) / NULLIF(SUM(n.sample_count), 0)
          FROM device_sensor.numeric_15min n
         WHERE n.device = ANY(v_owned)
           AND n.bucket >= v_from
           AND n.bucket <  v_to
           AND n.source <> 'internal'
           AND n.kind = ANY(p_sensor_kinds)
           AND n.sample_count > 0
         GROUP BY n.device, COALESCE(n.channel, 0), n.kind, n.bucket
    ),
    kept AS (
        SELECT s.scope_type, s.device, s.channel, s.tag, s.val,
               (s.bucket AT TIME ZONE p_tz) AS local_ts
          FROM samples s
         WHERE s.val IS NOT NULL
           AND fm.fn_baseline_value_ok(s.tag, s.val)
    ),
    filtered AS (
        SELECT k.scope_type, k.device, k.channel, k.tag, k.val,
               k.local_ts::DATE AS local_day,
               (EXTRACT(DOW  FROM k.local_ts)::INTEGER * 24
                + EXTRACT(HOUR FROM k.local_ts)::INTEGER)::SMALLINT AS hour_of_week
          FROM kept k
         WHERE NOT EXISTS (
                   SELECT 1 FROM excluded x
                    WHERE x.excluded_day = k.local_ts::DATE
               )
    ),
    scored AS (
        SELECT f.scope_type, f.device, f.channel, f.tag, f.local_day,
               (f.val - b.median_val)
                   / ((b.p75_val - b.p25_val) / 1.349) AS z
          FROM filtered f
          JOIN fm.hour_of_week_baseline b
            ON b.organization_id = p_organization_id
           AND b.scope_type      = f.scope_type
           AND b.device          = f.device
           AND b.channel         = f.channel
           AND b.tag             = f.tag
           AND b.hour_of_week    = f.hour_of_week
           -- A cell the read gate would withhold has no number to subtract.
         WHERE b.weeks_observed >= p_min_weeks
           -- A flat cell has NO scale. An epsilon here would invent one and
           -- turn every wobble into a large z. Refusing is the honest answer.
           AND b.p75_val > b.p25_val
    )
    SELECT p_organization_id,
           s.scope_type,
           s.device,
           s.channel,
           s.tag,
           s.local_day,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.z),
           COUNT(*)::INTEGER,
           p_now
      FROM scored s
     GROUP BY s.scope_type, s.device, s.channel, s.tag, s.local_day
    ON CONFLICT (organization_id, scope_type, device, channel, tag, local_day)
    DO UPDATE SET z_median     = EXCLUDED.z_median,
                  bucket_count = EXCLUDED.bucket_count,
                  computed_at  = EXCLUDED.computed_at;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Two-sided tabular CUSUM over the daily residuals.
--
--   S+_n = max(0, S+_(n-1) + z_n - k)
--   S-_n = max(0, S-_(n-1) - z_n - k)
--
-- k = 0.5 and h = 5 in robust-sigma units are the textbook design (Montgomery,
-- Introduction to Statistical Quality Control): in-control average run length
-- near 465, a 1-sigma shift detected in roughly ten samples. Ten samples is ten
-- days here: slow enough to ignore a bad weekend, fast enough to matter.
--
-- Each night reads the residual rows again, minus the days an existing alarm
-- already consumed, so a second run on the same night finds nothing new to say.
CREATE OR REPLACE FUNCTION fm.fn_baseline_detect_change_points(
    p_organization_id VARCHAR(120),
    p_devices         INTEGER[],
    p_tz              TEXT,
    -- Also the retention horizon. The caller passes the baseline window, so a
    -- change point cannot expire while the rebuild is still honouring it.
    p_lookback_days   INTEGER,
    p_k               DOUBLE PRECISION,
    p_h               DOUBLE PRECISION,
    p_min_days        INTEGER,
    p_now             TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_owned    INTEGER[];
    v_to_day   DATE;
    v_from_day DATE;
    v_rows     INTEGER;
BEGIN
    SELECT COALESCE(array_agg(l.id), ARRAY[]::INTEGER[])
      INTO v_owned
      FROM device.list l
     WHERE l.id = ANY(p_devices)
       AND l.organization_id = p_organization_id;

    IF COALESCE(array_length(v_owned, 1), 0) = 0 THEN
        RETURN 0;
    END IF;

    v_to_day   := (p_now AT TIME ZONE p_tz)::DATE;
    v_from_day := v_to_day - p_lookback_days;

    -- Expire first, so the run below neither reads a dead change point nor
    -- treats its days as already spent. A change point stops mattering once it
    -- falls out of the window, the same way a counter reset outside the window
    -- stops mattering: no separate cleanup job and no state to un-stick.
    DELETE FROM fm.baseline_change_point c
     WHERE c.organization_id = p_organization_id
       AND c.device = ANY(v_owned)
       AND c.changed_on < v_from_day;

    DELETE FROM fm.baseline_residual_day r
     WHERE r.organization_id = p_organization_id
       AND r.device = ANY(v_owned)
       AND r.local_day < v_from_day;

    INSERT INTO fm.baseline_change_point (
        organization_id, scope_type, device, channel, tag,
        state, direction, changed_on, cusum_value, residual_days, detected_at
    )
    WITH prior AS (
        SELECT c.scope_type, c.device, c.channel, c.tag, c.state, c.detected_at
          FROM fm.baseline_change_point c
         WHERE c.organization_id = p_organization_id
           AND c.device = ANY(v_owned)
    ),
    days AS (
        SELECT r.scope_type, r.device, r.channel, r.tag, r.local_day, r.z_median
          FROM fm.baseline_residual_day r
          LEFT JOIN prior p
                 ON p.scope_type = r.scope_type
                AND p.device     = r.device
                AND p.channel    = r.channel
                AND p.tag        = r.tag
         WHERE r.organization_id = p_organization_id
           AND r.device = ANY(v_owned)
           AND r.local_day >= v_from_day
           AND r.local_day <= v_to_day
           -- Every day a recorded ALARM already read is that alarm's evidence,
           -- not the next one's; without this the same step re-fires every
           -- night. The alarm read every day up to the local day it ran on,
           -- which is what detected_at pins. A warning does NOT consume its
           -- days, because a warning that keeps accumulating has to be allowed
           -- to become an alarm.
           AND (p.detected_at IS NULL
                OR p.state <> 'alarm'
                OR r.local_day > (p.detected_at AT TIME ZONE p_tz)::DATE)
    ),
    counted AS (
        SELECT d.scope_type, d.device, d.channel, d.tag, COUNT(*)::INTEGER AS n
          FROM days d
         GROUP BY d.scope_type, d.device, d.channel, d.tag
        HAVING COUNT(*) >= p_min_days
    ),
    cum AS (
        SELECT d.scope_type, d.device, d.channel, d.tag, d.local_day,
               SUM( d.z_median - p_k) OVER w AS c_up,
               SUM(-d.z_median - p_k) OVER w AS c_dn
          FROM days d
          JOIN counted n
            ON n.scope_type = d.scope_type
           AND n.device     = d.device
           AND n.channel    = d.channel
           AND n.tag        = d.tag
        WINDOW w AS (
            PARTITION BY d.scope_type, d.device, d.channel, d.tag
            ORDER BY d.local_day
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    -- The clamped-at-zero CUSUM has a closed form: it equals the running sum
    -- minus the running minimum of that sum, with 0 in the minimum. Exact, and
    -- it needs no recursive CTE. The arm is exactly 0 on the prefix-minimum
    -- days, which is what makes the change-day estimate below one query.
    stat AS (
        SELECT c.scope_type, c.device, c.channel, c.tag, c.local_day,
               c.c_up - LEAST(0, MIN(c.c_up) OVER w) AS s_up,
               c.c_dn - LEAST(0, MIN(c.c_dn) OVER w) AS s_dn
          FROM cum c
        WINDOW w AS (
            PARTITION BY c.scope_type, c.device, c.channel, c.tag
            ORDER BY c.local_day
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    peak AS (
        SELECT DISTINCT ON (s.scope_type, s.device, s.channel, s.tag)
               s.scope_type,
               s.device,
               s.channel,
               s.tag,
               s.local_day              AS peak_day,
               GREATEST(s.s_up, s.s_dn) AS peak_val,
               (CASE WHEN s.s_up >= s.s_dn THEN 'up' ELSE 'down' END)::VARCHAR(4)
                                        AS direction,
               n.n                      AS residual_days
          FROM stat s
          JOIN counted n
            ON n.scope_type = s.scope_type
           AND n.device     = s.device
           AND n.channel    = s.channel
           AND n.tag        = s.tag
         ORDER BY s.scope_type, s.device, s.channel, s.tag,
                  GREATEST(s.s_up, s.s_dn) DESC, s.local_day
    )
    SELECT p_organization_id,
           p.scope_type,
           p.device,
           p.channel,
           p.tag,
           (CASE WHEN p.peak_val >= p_h THEN 'alarm' ELSE 'warning' END)::VARCHAR(8),
           p.direction,
           -- The last day the crossing arm sat at zero is the last in-control
           -- day, so the regime starts the day after it. When the arm never sat
           -- at zero the series was already drifting at the first day we have,
           -- and that first day is the best estimate available.
           COALESCE(
               (SELECT MAX(z.local_day) + 1
                  FROM stat z
                 WHERE z.scope_type = p.scope_type
                   AND z.device     = p.device
                   AND z.channel    = p.channel
                   AND z.tag        = p.tag
                   AND z.local_day <= p.peak_day
                   AND (CASE WHEN p.direction = 'up' THEN z.s_up ELSE z.s_dn END) <= 0),
               (SELECT MIN(z2.local_day)
                  FROM stat z2
                 WHERE z2.scope_type = p.scope_type
                   AND z2.device     = p.device
                   AND z2.channel    = p.channel
                   AND z2.tag        = p.tag)
           ),
           p.peak_val,
           p.residual_days,
           p_now
      FROM peak p
     -- DDM's two stages: h/2 records a warning, h records an alarm.
     WHERE p.peak_val >= p_h / 2
    ON CONFLICT (organization_id, scope_type, device, channel, tag)
    DO UPDATE SET state         = EXCLUDED.state,
                  direction     = EXCLUDED.direction,
                  changed_on    = EXCLUDED.changed_on,
                  cusum_value   = EXCLUDED.cusum_value,
                  residual_days = EXCLUDED.residual_days,
                  detected_at   = EXCLUDED.detected_at
    -- A live alarm is never downgraded. It already spent its own days, so the
    -- mild remainder reads as a warning, and letting that win would move
    -- changed_on and hand the rebuild back the step it was told to cut at.
    -- Escalation is unaffected: a new alarm is still an alarm.
    WHERE EXCLUDED.state = 'alarm'
       OR fm.baseline_change_point.state <> 'alarm';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- What a reader needs about one series. Routed by the same grain rule as the
-- baseline read, so a caller never has to know that power is a device total.
CREATE OR REPLACE FUNCTION fm.fn_baseline_change_state(
    p_organization_id VARCHAR(120),
    p_device          INTEGER,
    p_channel         SMALLINT,
    p_tag             VARCHAR(30)
)
RETURNS TABLE (
    state       VARCHAR(8),
    direction   VARCHAR(4),
    changed_on  DATE,
    detected_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT c.state, c.direction, c.changed_on, c.detected_at
      FROM fm.baseline_change_point c
     WHERE c.organization_id = p_organization_id
       AND c.device          = p_device
       AND c.tag             = p_tag
       AND c.scope_type      = fm.fn_baseline_scope_type(p_tag)
       AND c.channel = CASE
               WHEN fm.fn_baseline_scope_type(p_tag) = 'device' THEN 0::SMALLINT
               ELSE p_channel
           END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_baseline_change_state(VARCHAR, INTEGER, SMALLINT, VARCHAR);
DROP FUNCTION IF EXISTS fm.fn_baseline_detect_change_points(
    VARCHAR, INTEGER[], TEXT, INTEGER, DOUBLE PRECISION, DOUBLE PRECISION,
    INTEGER, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS fm.fn_baseline_record_residuals(
    VARCHAR, INTEGER[], VARCHAR[], VARCHAR[], BOOLEAN, TEXT, INTEGER, INTEGER,
    TIMESTAMPTZ);
DROP TABLE IF EXISTS fm.baseline_change_point;
DROP TABLE IF EXISTS fm.baseline_residual_day;
