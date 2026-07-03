--------------UP
-- One price window inside a season. days_mask bit0=Mon..bit6=Sun. end_time is
-- exclusive. Manual price >= 0 (live tariffs carry no windows).
CREATE TABLE organization.tariff_window (
    id         INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    season_id  INTEGER NOT NULL REFERENCES organization.tariff_season(id) ON DELETE CASCADE,
    days_mask  SMALLINT NOT NULL CHECK (days_mask BETWEEN 1 AND 127),
    start_time TIME NOT NULL,
    end_time   TIME NOT NULL,
    price      DOUBLE PRECISION NOT NULL CHECK (price >= 0)
);
CREATE INDEX IF NOT EXISTS organization__tariff_window_season ON organization.tariff_window (season_id);
--------------DOWN
DROP TABLE IF EXISTS organization.tariff_window;
