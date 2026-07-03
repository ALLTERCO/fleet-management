--------------UP
-- Historical seed (single-tenant era). Obsolete under the multi-tenant
-- model — every dashboard now requires organization_id (enforced by
-- 6301_dashboard_organization_not_null.sql) and per-org bootstrap lives
-- in organization.fn_profile_ensure. Kept as a no-op so the ledger
-- entry stays consistent on environments that already applied it.
--------------DOWN
SELECT 1;
