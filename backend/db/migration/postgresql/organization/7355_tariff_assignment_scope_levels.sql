--------------UP
-- 7354 widened the column and added the hierarchy target constraint, but the
-- original inline CHECK from 7203 still admitted only dashboard/device/channel.
-- Replace that obsolete constraint so organization and location assignments
-- can use the hierarchy that 7354 introduced.
ALTER TABLE organization.tariff_assignment
    DROP CONSTRAINT IF EXISTS tariff_assignment_scope_level_check,
    ADD CONSTRAINT tariff_assignment_scope_level_check CHECK (
        scope_level IN ('organization','location','dashboard','device','channel')
    );

--------------DOWN
-- 7354 owns restoration of the legacy three-scope constraint after it removes
-- organization/location rows. Reinstalling it before 7354 DOWN would make a
-- valid hierarchy rollback fail on those rows.
SELECT 1;
