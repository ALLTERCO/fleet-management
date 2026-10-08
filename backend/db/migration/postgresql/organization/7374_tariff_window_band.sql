--------------UP
-- A window's time-of-use band is data, not a guess. Fleet derives it by
-- ranking the season's distinct prices, which labels backwards any network
-- whose named peak is not its dearest window, and cannot name a season with
-- more prices than there are band names. A declared band overrides the rank.
ALTER TABLE organization.tariff_window
    ADD COLUMN IF NOT EXISTS band VARCHAR(16);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.tariff_window'::regclass
           AND conname = 'organization__tariff_window_band'
    ) THEN
        ALTER TABLE organization.tariff_window
            ADD CONSTRAINT organization__tariff_window_band CHECK (
                band IS NULL OR band IN ('peak', 'shoulder', 'off_peak')
            );
    END IF;
END;
$$;

-- Keep the previous implementations for the reversible wrappers, exactly as
-- 7358 did with the 7357 pair.
ALTER FUNCTION organization.fn_tariff_upsert(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_upsert_v7358;
ALTER FUNCTION organization.fn_tariff_get(VARCHAR, INTEGER)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_get_v7358;

-- Full redefinition rather than a wrapper: the band belongs inside each
-- window of the seasons array, and reaching in from outside would mean
-- matching payload entries back to inserted rows by position.
CREATE FUNCTION organization.fn_tariff_upsert(p_org VARCHAR, p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
    v_season JSONB;
    v_season_id INTEGER;
    v_win JSONB;
BEGIN
    -- The inner function owns the tariff row and its commodity columns. It
    -- also writes the seasons, which are then rewritten here with their bands.
    -- That repeats a small write on a rarely-written, small table, and it is
    -- the deliberate price of not copying the tariff-row SQL into a fourth
    -- place where it would drift, and of not matching payload windows back to
    -- inserted rows by position.
    v_id := organization.fn_tariff_upsert_v7358(p_org, p_payload);

    DELETE FROM organization.tariff_season WHERE tariff_id = v_id;
    FOR v_season IN
        SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'seasons', '[]'::jsonb))
    LOOP
        INSERT INTO organization.tariff_season (tariff_id, start_md, end_md)
        VALUES (v_id, v_season->>'startMonthDay', v_season->>'endMonthDay')
        RETURNING id INTO v_season_id;
        FOR v_win IN
            SELECT * FROM jsonb_array_elements(COALESCE(v_season->'windows', '[]'::jsonb))
        LOOP
            INSERT INTO organization.tariff_window
                (season_id, days_mask, start_time, end_time, price, band)
            VALUES (
                v_season_id,
                (v_win->>'daysMask')::SMALLINT,
                (v_win->>'startTime')::TIME,
                (v_win->>'endTime')::TIME,
                (v_win->>'price')::DOUBLE PRECISION,
                NULLIF(v_win->>'band', '')
            );
        END LOOP;
    END LOOP;
    RETURN v_id;
END;
$$;

CREATE FUNCTION organization.fn_tariff_get(p_org VARCHAR, p_id INTEGER)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT organization.fn_tariff_get_v7358(p_org, p_id)
           || jsonb_build_object(
                  'seasons',
                  COALESCE(
                      (
                          SELECT jsonb_agg(
                              jsonb_build_object(
                                  'startMonthDay', s.start_md,
                                  'endMonthDay', s.end_md,
                                  'windows', COALESCE(
                                      (
                                          SELECT jsonb_agg(
                                              jsonb_strip_nulls(
                                                  jsonb_build_object(
                                                      'daysMask', w.days_mask,
                                                      'startTime', to_char(w.start_time, 'HH24:MI'),
                                                      'endTime', to_char(w.end_time, 'HH24:MI'),
                                                      'price', w.price,
                                                      'band', w.band
                                                  )
                                              ) ORDER BY w.id
                                          )
                                          FROM organization.tariff_window w
                                          WHERE w.season_id = s.id
                                      ),
                                      '[]'::jsonb
                                  )
                              ) ORDER BY s.id
                          )
                          FROM organization.tariff_season s
                          WHERE s.tariff_id = t.id
                      ),
                      '[]'::jsonb
                  )
              )
      FROM organization.tariff t
     WHERE t.id = p_id AND t.organization_id = p_org;
$$;

--------------DOWN
-- LINT-IGNORE: additive-only -- restores the pre-band pair.
DROP FUNCTION IF EXISTS organization.fn_tariff_get(VARCHAR, INTEGER);
-- LINT-IGNORE: additive-only -- restores the pre-band pair.
DROP FUNCTION IF EXISTS organization.fn_tariff_upsert(VARCHAR, JSONB);
ALTER FUNCTION organization.fn_tariff_get_v7358(VARCHAR, INTEGER)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_get;
ALTER FUNCTION organization.fn_tariff_upsert_v7358(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_upsert;
ALTER TABLE organization.tariff_window
    DROP CONSTRAINT IF EXISTS organization__tariff_window_band;
-- LINT-IGNORE: additive-only -- rollback removes the band column it added.
ALTER TABLE organization.tariff_window DROP COLUMN IF EXISTS band;
