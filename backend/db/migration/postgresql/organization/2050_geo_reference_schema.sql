--------------UP
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS geo;

CREATE TABLE geo.countries (
    iso2          CHAR(2) PRIMARY KEY,
    iso3          CHAR(3) NOT NULL,
    name          TEXT NOT NULL,
    capital       TEXT,
    continent     CHAR(2) NOT NULL,
    currency_code CHAR(3),
    phone_code    TEXT,
    geonameid     INTEGER UNIQUE,
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION
);

CREATE TABLE geo.admin (
    code          TEXT PRIMARY KEY,
    country_code  CHAR(2) NOT NULL REFERENCES geo.countries(iso2),
    name          TEXT NOT NULL,
    asciiname     TEXT NOT NULL,
    geonameid     INTEGER UNIQUE,
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL
);

CREATE TABLE geo.cities (
    geonameid     INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    asciiname     TEXT NOT NULL,
    country_code  CHAR(2) NOT NULL REFERENCES geo.countries(iso2),
    admin_code    TEXT,
    feature_code  TEXT,
    population    INTEGER NOT NULL DEFAULT 0,
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    timezone      TEXT
);

CREATE INDEX cities_asciiname_trgm
    ON geo.cities USING GIN (asciiname gin_trgm_ops);
CREATE INDEX cities_country     ON geo.cities (country_code);
CREATE INDEX cities_population  ON geo.cities (population DESC);

CREATE TABLE geo.places (
    place_id      BIGSERIAL PRIMARY KEY,
    kind          TEXT NOT NULL,
    geonameid     INTEGER UNIQUE,
    name          TEXT NOT NULL,
    asciiname     TEXT NOT NULL,
    country_code  CHAR(2) NOT NULL REFERENCES geo.countries(iso2),
    admin_code    TEXT,
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    timezone      TEXT,
    weight        BIGINT NOT NULL,
    CHECK (kind IN ('country','admin','city'))
);

CREATE INDEX places_asciiname_trgm
    ON geo.places USING GIN (asciiname gin_trgm_ops);
CREATE INDEX places_country_kind ON geo.places (country_code, kind);
CREATE INDEX places_weight       ON geo.places (weight DESC);

CREATE TABLE geo.import_metadata (
    id                SERIAL PRIMARY KEY,
    imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_version    TEXT,
    cities_count      INTEGER,
    countries_count   INTEGER
);

UPDATE organization.locations
   SET geo = jsonb_set(geo, '{source}', '"imported"')
 WHERE geo IS NOT NULL
   AND geo->>'source' IS NULL;

--------------DOWN
DROP SCHEMA IF EXISTS geo CASCADE;
