--------------UP
-- Actual utility-bill amounts per org + billing period, for report-vs-bill
-- reconciliation. The energy report compares its computed cost to the actual
-- recorded here and shows the variance.
CREATE TABLE IF NOT EXISTS organization.bill_actuals (
    id              BIGSERIAL PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    actual_cost     NUMERIC NOT NULL CHECK (actual_cost >= 0),
    currency        VARCHAR(3) NOT NULL DEFAULT 'EUR'
        CHECK (currency ~ '^[A-Z]{3}$'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ,
    CHECK (period_end >= period_start),
    UNIQUE (organization_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_bill_actuals_org_period
    ON organization.bill_actuals (organization_id, period_start, period_end);

--------------DOWN
DROP TABLE IF EXISTS organization.bill_actuals;
