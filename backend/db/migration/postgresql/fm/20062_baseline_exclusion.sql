--------------UP
-- Operator-declared days that must not shape "normal".
-- A 56-day window holds 8 occurrences of each hour of the week, so one public
-- holiday is about 1/8 of a fine cell's evidence, replaced by a value that is
-- not what that hour normally looks like.
-- PJM, CAISO and NYISO all exclude holidays and event days from their customer
-- baselines; AWS ships operator-declared exclusion ranges as the same control.
-- ASHRAE Guideline 14 forbids removing baseline points, which is correct for
-- measurement and verification, where the saving is the difference between two
-- whole periods. This table answers "what does a normal hour look like", the
-- settlement-side question, so it filters. It is an operational signal only.
-- Days are LOCAL dates in the org's resolved zone: a holiday is a wall-clock
-- day, not a UTC one. Whole-org grain, matching the timezone grain.
-- No over-exclusion guardrail on purpose: excluding days lowers weeks_observed
-- and the sufficiency gate already refuses a cell below the floor, so an
-- operator who excludes everything gets NULL, not a confident wrong answer.
-- public only, everything schema-qualified; do not leak the schema to later migrations.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS fm.baseline_exclusion (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    from_day        DATE         NOT NULL,
    -- Inclusive. A single-day holiday is from_day = to_day.
    to_day          DATE         NOT NULL,
    -- Required. An exclusion nobody can explain later is unauditable, and this
    -- is the one place a human silently deletes evidence.
    reason          VARCHAR(200) NOT NULL,
    created_by      VARCHAR(120),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT baseline_exclusion_range_chk CHECK (to_day >= from_day),
    CONSTRAINT baseline_exclusion_reason_chk CHECK (length(btrim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS baseline_exclusion_org_range_idx
    ON fm.baseline_exclusion (organization_id, from_day, to_day);

COMMENT ON TABLE fm.baseline_exclusion IS
    'Operator-declared local date ranges excluded from the hour-of-week baseline: holidays, outages, commissioning.';

-- Distinct local days to skip, clipped to the asked window. Overlapping ranges
-- collapse here rather than in the rebuild, so the rebuild's anti-join and its
-- excluded_days count both see each day once.
CREATE OR REPLACE FUNCTION fm.fn_baseline_excluded_days(
    p_organization_id VARCHAR(120),
    p_from_day        DATE,
    p_to_day          DATE
)
RETURNS TABLE (excluded_day DATE)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT d::DATE
      FROM fm.baseline_exclusion x
      CROSS JOIN LATERAL generate_series(
              GREATEST(x.from_day, p_from_day)::TIMESTAMP,
              LEAST(x.to_day, p_to_day)::TIMESTAMP,
              INTERVAL '1 day') AS d
     WHERE x.organization_id = p_organization_id
       AND x.from_day <= p_to_day
       AND x.to_day   >= p_from_day;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_baseline_excluded_days(VARCHAR, DATE, DATE);
DROP TABLE IF EXISTS fm.baseline_exclusion;
