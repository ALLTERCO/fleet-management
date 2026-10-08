--------------UP
-- Keeps insufficient baseline quantiles unreachable to every caller.
SET search_path TO public;

CREATE OR REPLACE FUNCTION fm.fn_hour_of_week_baseline(
    p_organization_id VARCHAR(120),
    p_device          INTEGER,
    p_channel         SMALLINT,
    p_tag             VARCHAR(30),
    p_min_weeks       INTEGER
)
RETURNS TABLE (
    hour_of_week    SMALLINT,
    bin_scheme      VARCHAR(16),
    p25_val         DOUBLE PRECISION,
    median_val      DOUBLE PRECISION,
    p75_val         DOUBLE PRECISION,
    sample_count    INTEGER,
    weeks_observed  SMALLINT,
    first_seen_day  DATE,
    window_from_day DATE,
    excluded_days   SMALLINT,
    ready           BOOLEAN,
    timezone        VARCHAR(120),
    computed_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT b.hour_of_week,
           b.bin_scheme,
           CASE WHEN b.weeks_observed >= p_min_weeks THEN b.p25_val END,
           CASE WHEN b.weeks_observed >= p_min_weeks THEN b.median_val END,
           CASE WHEN b.weeks_observed >= p_min_weeks THEN b.p75_val END,
           b.sample_count,
           b.weeks_observed,
           b.first_seen_day,
           b.window_from_day,
           b.excluded_days,
           b.weeks_observed >= p_min_weeks,
           b.timezone,
           b.computed_at
      FROM fm.hour_of_week_baseline b
     WHERE b.organization_id = p_organization_id
       AND b.device = p_device
       AND b.tag = p_tag
       AND b.scope_type = fm.fn_baseline_scope_type(p_tag)
       AND b.channel = CASE
               WHEN fm.fn_baseline_scope_type(p_tag) = 'device' THEN 0::SMALLINT
               ELSE p_channel
           END
     ORDER BY b.hour_of_week;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_hour_of_week_baseline(
    VARCHAR, INTEGER, SMALLINT, VARCHAR, INTEGER
);
