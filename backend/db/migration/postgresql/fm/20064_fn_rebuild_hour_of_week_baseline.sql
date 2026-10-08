--------------UP
-- Rebuild one organization's hour-of-week baseline for a batch of devices.
--
-- An INCREMENTAL MODEL WITH AN N-DAY LOOKBACK WINDOW, run as a full recompute
-- of that window. That is the industry name for this shape: dbt calls the knob
-- `lookback`, Snowplow calls it `lookback_window_hours`, and both mean the same
-- thing: reprocess a fixed trailing span every run rather than appending.
--
-- Why recompute rather than append: an exact quantile cannot be updated without
-- keeping the samples, and the samples are kept forever in both rollups.
-- Snowflake's dynamic tables reach the same conclusion automatically; they fall
-- back to a FULL refresh for queries that cannot be incrementalised, and name
-- exact percentile functions as exactly such a query. What makes the recompute
-- affordable is that the window is 56 days: the job never reads past.
--
-- One call = one transaction = one device batch. The caller batches so no tick
-- holds a long transaction, and a night that runs out of budget still leaves
-- every device it processed complete.
--
-- Tags arrive as parameters. types/api/_baselineTags.ts is their one home; what
-- this function owns is the grain rule and which reader serves which family.
-- public only, everything schema-qualified; do not leak the schema to later migrations.
SET search_path TO public;

CREATE OR REPLACE FUNCTION fm.fn_rebuild_hour_of_week_baseline(
    p_organization_id VARCHAR(120),
    p_devices         INTEGER[],
    p_energy_tags     VARCHAR(30)[],
    p_sensor_kinds    VARCHAR(24)[],
    p_include_power   BOOLEAN,
    p_tz              TEXT,
    p_window_days     INTEGER,
    -- EXTRACT(DOW) values that count as weekend. Parameterised because
    -- Sunday/Saturday is wrong for a Friday/Saturday working week.
    p_weekend_dows    SMALLINT[],
    -- Distinct weeks a series needs before it earns 168 bins instead of 48.
    p_graduate_weeks  INTEGER,
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
    -- Tenancy in SQL, not in the caller. A device this org does not own is
    -- never read and never written, whatever the caller passed.
    SELECT COALESCE(array_agg(l.id), ARRAY[]::INTEGER[])
      INTO v_owned
      FROM device.list l
     WHERE l.id = ANY(p_devices)
       AND l.organization_id = p_organization_id;

    IF COALESCE(array_length(v_owned, 1), 0) = 0 THEN
        RETURN 0;
    END IF;

    -- The window ends at the last local midnight, so a partially-collected
    -- current day never enters a baseline it will later contradict.
    v_to   := date_trunc('day', p_now AT TIME ZONE p_tz) AT TIME ZONE p_tz;
    v_from := v_to - make_interval(days => p_window_days);

    v_from_day := (v_from AT TIME ZONE p_tz)::DATE;
    v_to_day   := (v_to   AT TIME ZONE p_tz)::DATE;

    -- Counted once, stored on every row, so a reader can see the window was
    -- filtered and by how much. Exclusions are org-grain, so this is too.
    SELECT COUNT(*)
      INTO v_excluded
      FROM fm.fn_baseline_excluded_days(p_organization_id, v_from_day, v_to_day);

    DELETE FROM fm.hour_of_week_baseline b
     WHERE b.organization_id = p_organization_id
       AND b.device = ANY(v_owned);

    INSERT INTO fm.hour_of_week_baseline (
        organization_id, scope_type, device, channel, tag, hour_of_week,
        bin_scheme, p25_val, median_val, p75_val,
        sample_count, weeks_observed, first_seen_day, window_from_day,
        excluded_days, timezone, window_days, computed_at
    )
    WITH excluded_day_set AS (
        SELECT x.excluded_day
          FROM fm.fn_baseline_excluded_days(
                   p_organization_id, v_from_day, v_to_day) x
    ),
    -- VEE, validation stage. (device, channel) survives a physical meter swap,
    -- so without this the previous meter's weeks stay in the window and become
    -- part of what counts as normal for a meter that was never installed.
    -- last_reset_ts fires when a counter steps backwards, which is what a
    -- replacement meter starting at zero does.
    -- The counter's identity carries domain too (6777), which the rollup reader
    -- collapses, so take the latest reset across domains rather than one row per
    -- domain: a second row here would duplicate every sample it joins to.
    reset_gate AS (
        SELECT lc.device,
               lc.channel,
               lc.tag,
               MAX(lc.last_reset_ts) AS last_reset_ts
          FROM device_em.lifetime_counters lc
         WHERE lc.device = ANY(v_owned)
           AND lc.last_reset_ts IS NOT NULL
           AND lc.last_reset_ts > v_from
           AND lc.last_reset_ts < v_to
         GROUP BY lc.device, lc.channel, lc.tag
    ),
    -- Power is device grain, so any channel's reset makes the device's power
    -- history suspect. Take the latest.
    device_reset_gate AS (
        SELECT g.device, MAX(g.last_reset_ts) AS last_reset_ts
          FROM reset_gate g
         GROUP BY g.device
    ),
    -- ADWIN's rule, using the machinery the reset gate already built: when the
    -- CUSUM detector alarms, the window shrinks to the new regime rather than
    -- blending two populations for eight weeks. weeks_observed then falls under
    -- the sufficiency floor, so the READ gate refuses to compare until three
    -- weeks of the new regime exist. No second gate exists and none was needed.
    --
    -- Sensors ARE gated here, unlike the reset gate. A counter reset is
    -- meaningless for a thermometer; a level shift is not, because a new HVAC
    -- setpoint steps a room's profile the way a new tenant steps a load.
    --
    -- Only 'alarm' truncates. A 'warning' is reported and nothing else.
    -- The changed_on > v_from_day test is what makes a change point expire on
    -- its own, exactly as last_reset_ts > v_from does above.
    change_gate AS (
        SELECT c.scope_type,
               c.device,
               c.channel,
               c.tag,
               (c.changed_on::TIMESTAMP AT TIME ZONE p_tz) AS changed_ts
          FROM fm.baseline_change_point c
         WHERE c.organization_id = p_organization_id
           AND c.device = ANY(v_owned)
           AND c.state = 'alarm'
           AND c.changed_on > v_from_day
    ),
    samples AS (
        -- Channel energy. fn_report_energy_15min_by_channel is the SSOT for
        -- per-channel 15-minute energy and already sums across phase (6766),
        -- so a monophase Pro 3EM collapses the same way reports collapse it.
        SELECT fm.fn_baseline_scope_type(e.tag) AS scope_type,
               e.device                         AS device,
               COALESCE(e.channel, 0)::SMALLINT AS channel,
               e.tag                            AS tag,
               e.bucket                         AS bucket,
               e.energy_wh                      AS val,
               GREATEST(v_from,
                        COALESCE(rg.last_reset_ts, v_from),
                        COALESCE(cg.changed_ts,    v_from)) AS win_from
          FROM device_em.fn_report_energy_15min_by_channel(
                   v_owned, v_from, v_to, p_energy_tags) e
          LEFT JOIN reset_gate rg
                 ON rg.device  = e.device
                AND rg.channel = COALESCE(e.channel, 0)::SMALLINT
                AND rg.tag     = e.tag
          LEFT JOIN change_gate cg
                 ON cg.scope_type = 'device_channel'
                AND cg.device     = e.device
                AND cg.channel    = COALESCE(e.channel, 0)::SMALLINT
                AND cg.tag        = e.tag
         WHERE e.bucket >= GREATEST(v_from,
                                    COALESCE(rg.last_reset_ts, v_from),
                                    COALESCE(cg.changed_ts,    v_from))

        UNION ALL

        -- Power. It MUST come through fn_device_power_avg: that function
        -- carries the per-phase-wins ladder, the electricity scope and the
        -- MAX(sample_count) weighting (20046). A raw per-phase average here
        -- would read a three-phase meter a third low, the exact bug 20044 and
        -- 20046 exist to have fixed.
        SELECT fm.fn_baseline_scope_type('power'),
               p.device,
               0::SMALLINT,
               'power'::VARCHAR(30),
               p.bucket,
               p.avg_w,
               GREATEST(v_from,
                        COALESCE(drg.last_reset_ts, v_from),
                        COALESCE(pcg.changed_ts,    v_from))
          FROM device_em.fn_device_power_avg(
                   v_owned, v_from, v_to, '15 minutes') p
          LEFT JOIN device_reset_gate drg ON drg.device = p.device
          LEFT JOIN change_gate pcg
                 ON pcg.scope_type = 'device'
                AND pcg.device     = p.device
                AND pcg.channel    = 0
                AND pcg.tag        = 'power'
         WHERE p_include_power
           AND p.bucket >= GREATEST(v_from,
                                    COALESCE(drg.last_reset_ts, v_from),
                                    COALESCE(pcg.changed_ts,    v_from))

        UNION ALL

        -- Ambient sensors. numeric_15min is read directly rather than through
        -- fn_numeric_history because that function groups BY source and drops
        -- channel, and this needs the opposite of both: channel kept, ambient
        -- sources collapsed. source='internal' is the device's own chip and is
        -- health, never the room.
        SELECT fm.fn_baseline_scope_type(n.kind::VARCHAR(30)),
               n.device,
               COALESCE(n.channel, 0)::SMALLINT,
               n.kind::VARCHAR(30),
               n.bucket,
               SUM(n.sum_val) / NULLIF(SUM(n.sample_count), 0),
               -- No RESET gate: a sensor has no counter, and a replaced BLU
               -- H&T reports the same room. The CHANGE gate does apply.
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
        SELECT s.scope_type,
               s.device,
               s.channel,
               s.tag,
               s.val,
               s.win_from,
               (s.bucket AT TIME ZONE p_tz) AS local_ts
          FROM samples s
         WHERE s.val IS NOT NULL
           -- A value that cannot exist must not reach the sort: the band it
           -- would widen is what a consumer measures "how far outside" against.
           AND fm.fn_baseline_value_ok(s.tag, s.val)
    ),
    filtered AS (
        SELECT k.*,
               -- EXTRACT(DOW) is 0=Sunday, the same numbering weekdayInZone()
               -- returns, so TS and SQL need no conversion between them.
               EXTRACT(DOW  FROM k.local_ts)::INTEGER AS dow,
               EXTRACT(HOUR FROM k.local_ts)::INTEGER AS hour_of_day
          FROM kept k
         WHERE NOT EXISTS (
                   SELECT 1 FROM excluded_day_set x
                    WHERE x.excluded_day = k.local_ts::DATE
               )
    ),
    -- One row per series: has it seen enough distinct weeks to earn 168 bins?
    -- A 56-day window spans at most 9 week starts, so p_graduate_weeks >= 10
    -- pins a fleet to the coarse scheme permanently.
    series AS (
        SELECT f.scope_type,
               f.device,
               f.channel,
               f.tag,
               COUNT(DISTINCT date_trunc('week', f.local_ts)) AS series_weeks
          FROM filtered f
         GROUP BY f.scope_type, f.device, f.channel, f.tag
    ),
    binned AS (
        SELECT f.scope_type,
               f.device,
               f.channel,
               f.tag,
               f.val,
               f.win_from,
               f.local_ts,
               CASE WHEN s.series_weeks >= p_graduate_weeks
                    THEN 'hour_of_week' ELSE 'day_type_hour' END::VARCHAR(16)
                   AS bin_scheme,
               CASE WHEN s.series_weeks >= p_graduate_weeks
                    -- 168 bins: one per hour of the week.
                    THEN f.dow * 24 + f.hour_of_day
                    -- 48 bins: working day / weekend x hour. Pooling weekdays
                    -- multiplies the evidence per bin by five, which is the
                    -- mitigation for fitting 168 free cells to 8 weekly
                    -- observations each (OpenDSM retired that model; the
                    -- naive binned model in Granderson et al. 2016 went from
                    -- 20.77 to 42.69 CV(RMSE) on a short baseline).
                    ELSE fm.fn_baseline_day_type(f.dow, p_weekend_dows)::INTEGER * 24
                         + f.hour_of_day
               END::SMALLINT AS bin
          FROM filtered f
          JOIN series s
            ON s.scope_type = f.scope_type
           AND s.device     = f.device
           AND s.channel    = f.channel
           AND s.tag        = f.tag
    ),
    agg AS (
        SELECT b.scope_type,
               b.device,
               b.channel,
               b.tag,
               b.bin_scheme,
               b.bin,
               -- ONE sort, three quantiles. Plain PostgreSQL: percentile_agg /
               -- tdigest / uddsketch live in timescaledb_toolkit, which the
               -- community image does not ship. A sketch would buy rollup-able
               -- state, which is the only thing percentile_cont cannot do.
               percentile_cont(ARRAY[0.25, 0.5, 0.75])
                   WITHIN GROUP (ORDER BY b.val) AS q,
               COUNT(*)::INTEGER AS sample_count,
               -- Distinct local weeks, not buckets. Buckets inside one hour are
               -- minutes apart and are not independent evidence about it.
               COUNT(DISTINCT date_trunc('week', b.local_ts))::SMALLINT
                   AS weeks_observed,
               MIN(b.local_ts)::DATE AS first_seen_day,
               (MIN(b.win_from) AT TIME ZONE p_tz)::DATE AS window_from_day
          FROM binned b
         GROUP BY b.scope_type, b.device, b.channel, b.tag,
                  b.bin_scheme, b.bin
    )
    -- Fan a coarse bin out to every hour it covers, so the table is always 168
    -- rows per series and no reader has to know which scheme produced it.
    SELECT p_organization_id,
           a.scope_type,
           a.device,
           a.channel,
           a.tag,
           h.hour_of_week::SMALLINT,
           a.bin_scheme,
           a.q[1],
           a.q[2],
           a.q[3],
           a.sample_count,
           a.weeks_observed,
           a.first_seen_day,
           a.window_from_day,
           v_excluded::SMALLINT,
           p_tz,
           p_window_days::SMALLINT,
           p_now
      FROM agg a
      JOIN generate_series(0, 167) AS h(hour_of_week)
        ON a.bin = CASE
                       WHEN a.bin_scheme = 'hour_of_week'
                           THEN h.hour_of_week
                       ELSE fm.fn_baseline_day_type(
                                h.hour_of_week / 24, p_weekend_dows)::INTEGER * 24
                            + (h.hour_of_week % 24)
                   END;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_rebuild_hour_of_week_baseline(
    VARCHAR, INTEGER[], VARCHAR[], VARCHAR[], BOOLEAN, TEXT, INTEGER,
    SMALLINT[], INTEGER, TIMESTAMPTZ);
