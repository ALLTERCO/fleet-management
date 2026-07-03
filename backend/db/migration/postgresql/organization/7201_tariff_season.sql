--------------UP
-- A season is a recurring date range (month-day), resolved to the report year.
-- single/day_night/tou tariffs use one all-year season '01-01'..'12-31'.
CREATE TABLE organization.tariff_season (
    id        INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tariff_id INTEGER NOT NULL REFERENCES organization.tariff(id) ON DELETE CASCADE,
    start_md  CHAR(5) NOT NULL,  -- 'MM-DD'
    end_md    CHAR(5) NOT NULL   -- 'MM-DD'
);
CREATE INDEX IF NOT EXISTS organization__tariff_season_tariff ON organization.tariff_season (tariff_id);
--------------DOWN
DROP TABLE IF EXISTS organization.tariff_season;
