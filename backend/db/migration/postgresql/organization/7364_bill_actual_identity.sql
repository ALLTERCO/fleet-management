--------------UP
-- A period is not a bill identity: one organization may have several utility
-- accounts and several meters billed over the same dates. Nullable identifiers
-- preserve legacy rows while allowing an exact account/meter/service-point key.
ALTER TABLE organization.bill_actuals
    ADD COLUMN IF NOT EXISTS utility_account_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS meter_identifier VARCHAR(120),
    ADD COLUMN IF NOT EXISTS service_point_identifier VARCHAR(120);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.bill_actuals'::regclass
           AND conname = 'bill_actuals_utility_account_id_chk'
    ) THEN
        ALTER TABLE organization.bill_actuals
            ADD CONSTRAINT bill_actuals_utility_account_id_chk CHECK (
                utility_account_id IS NULL OR (
                    utility_account_id = btrim(utility_account_id)
                    AND utility_account_id <> ''
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.bill_actuals'::regclass
           AND conname = 'bill_actuals_meter_identifier_chk'
    ) THEN
        ALTER TABLE organization.bill_actuals
            ADD CONSTRAINT bill_actuals_meter_identifier_chk CHECK (
                meter_identifier IS NULL OR (
                    meter_identifier = btrim(meter_identifier)
                    AND meter_identifier <> ''
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.bill_actuals'::regclass
           AND conname = 'bill_actuals_service_point_identifier_chk'
    ) THEN
        ALTER TABLE organization.bill_actuals
            ADD CONSTRAINT bill_actuals_service_point_identifier_chk CHECK (
                service_point_identifier IS NULL OR (
                    service_point_identifier = btrim(service_point_identifier)
                    AND service_point_identifier <> ''
                )
            );
    END IF;
END;
$$;

-- Replace the legacy period-only uniqueness rule with the complete identity.
-- LINT-IGNORE: additive-only -- the old key prevents additive multi-account rows.
ALTER TABLE organization.bill_actuals
    DROP CONSTRAINT IF EXISTS bill_actuals_organization_id_period_start_period_end_key;

CREATE UNIQUE INDEX IF NOT EXISTS bill_actuals_org_period_identity_uq
    ON organization.bill_actuals (
        organization_id,
        period_start,
        period_end,
        (COALESCE(utility_account_id, '')),
        (COALESCE(meter_identifier, '')),
        (COALESCE(service_point_identifier, ''))
    );

CREATE INDEX IF NOT EXISTS bill_actuals_org_identity_period_idx
    ON organization.bill_actuals (
        organization_id,
        utility_account_id,
        meter_identifier,
        service_point_identifier,
        period_start,
        period_end
    );

--------------DOWN
-- Rollback is lossless only after an operator has consolidated same-period
-- multi-account rows. Refuse instead of silently deleting or picking one bill.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM organization.bill_actuals
         GROUP BY organization_id, period_start, period_end
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'cannot roll back bill identity while same-period multi-account rows exist';
    END IF;
END;
$$;

DROP INDEX IF EXISTS organization.bill_actuals_org_identity_period_idx;
DROP INDEX IF EXISTS organization.bill_actuals_org_period_identity_uq;

ALTER TABLE organization.bill_actuals
    DROP CONSTRAINT IF EXISTS bill_actuals_service_point_identifier_chk,
    DROP CONSTRAINT IF EXISTS bill_actuals_meter_identifier_chk,
    DROP CONSTRAINT IF EXISTS bill_actuals_utility_account_id_chk,
    DROP COLUMN IF EXISTS service_point_identifier,
    DROP COLUMN IF EXISTS meter_identifier,
    DROP COLUMN IF EXISTS utility_account_id;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.bill_actuals'::regclass
           AND conname =
               'bill_actuals_organization_id_period_start_period_end_key'
    ) THEN
        ALTER TABLE organization.bill_actuals
            ADD CONSTRAINT
                bill_actuals_organization_id_period_start_period_end_key
            UNIQUE (organization_id, period_start, period_end);
    END IF;
END;
$$;
