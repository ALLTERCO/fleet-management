--------------UP
-- Org-level tariff library. One row per named tariff; seasons/windows hang off
-- it. kind reuses the dashboard TariffMode enum plus 'live'. demand_rate drives
-- the existing demand-charge math; standing_charge + vat_pct complete the bill.
CREATE TABLE organization.tariff (
    id                     INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id        VARCHAR(120) NOT NULL
                             REFERENCES organization.profile(id) ON DELETE CASCADE,
    name                   VARCHAR(120) NOT NULL,
    currency               VARCHAR(8)   NOT NULL,
    timezone               VARCHAR(64)  NOT NULL,
    billing_day            SMALLINT     NOT NULL DEFAULT 1
                             CHECK (billing_day BETWEEN 1 AND 28),
    kind                   VARCHAR(16)  NOT NULL
                             CHECK (kind IN ('single','day_night','tou','live')),
    standing_charge        DOUBLE PRECISION NOT NULL DEFAULT 0
                             CHECK (standing_charge >= 0),
    standing_charge_period VARCHAR(8)   NOT NULL DEFAULT 'month'
                             CHECK (standing_charge_period IN ('day','month')),
    vat_pct                DOUBLE PRECISION,
    demand_rate            DOUBLE PRECISION CHECK (demand_rate IS NULL OR demand_rate >= 0),
    created                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated                TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS organization__tariff_org ON organization.tariff (organization_id);
--------------DOWN
DROP TABLE IF EXISTS organization.tariff;
