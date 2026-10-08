--------------UP
-- Carbon interval calculations need every factor revision that overlaps the
-- requested window. The existing resolver intentionally returns only one
-- factor covering the whole window and remains unchanged for Carbon.Calculate.
CREATE OR REPLACE FUNCTION organization.fn_emission_factor_list_overlapping(
    p_org VARCHAR(120),
    p_commodity VARCHAR(48),
    p_billed_unit VARCHAR(24),
    p_regions VARCHAR(120)[],
    p_accounting_basis VARCHAR(24),
    p_emissions_scope VARCHAR(16),
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS SETOF organization.emission_factor
AS $$
    SELECT factor.*
      FROM organization.emission_factor factor
     WHERE factor.organization_id = p_org
       AND factor.commodity = p_commodity
       AND factor.billed_unit = p_billed_unit
       AND factor.region = ANY(array_append(p_regions, 'global'))
       AND factor.accounting_basis = p_accounting_basis
       AND factor.emissions_scope = p_emissions_scope
       AND factor.effective_from < p_to
       AND (factor.effective_to IS NULL OR factor.effective_to > p_from)
     ORDER BY factor.region, factor.effective_from,
              factor.revision DESC, factor.created_at DESC;
$$ LANGUAGE sql STABLE;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_emission_factor_list_overlapping(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR[], VARCHAR, VARCHAR, TIMESTAMPTZ,
    TIMESTAMPTZ
);
