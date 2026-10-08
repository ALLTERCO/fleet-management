// One-shot fetch for everything the carbon section needs from a dashboard.

import {getLogger} from 'log4js';
import {tuning} from '../../config';
import {dashboardBelongsToOrg} from '../../modules/DashboardRegistry';
import * as PostgresProvider from '../../modules/PostgresProvider';

const logger = getLogger('dashboardCarbonContext');

export interface DashboardCarbonContext {
    readonly lbmGPerKWh: number;
    readonly mbmGPerKWh: number | null;
    readonly budgetKg: number | null;
    readonly source: 'dashboard' | 'factor_store' | 'env_default';
}

export interface DashboardCarbonOverrides {
    readonly lbmGPerKWh: number | null;
    readonly mbmGPerKWh: number | null;
    readonly budgetKg: number | null;
}

interface Row {
    emission_factor_g_per_kwh: number | null;
    emission_factor_mbm_g_per_kwh: number | null;
    co2_budget_kg: number | null;
}

export async function fetchDashboardCarbonContext(
    dashboardId: number | null | undefined,
    orgId: string
): Promise<DashboardCarbonContext> {
    if (!isValidDashboardId(dashboardId)) return envFallback();
    // Org gate: ui.dashboard_settings has no org column, so a crafted
    // dashboardId could otherwise read another tenant's carbon config.
    if (!(await dashboardBelongsToOrg(dashboardId, orgId))) {
        return envFallback();
    }
    const row = await fetchRowBestEffort(dashboardId);
    if (!row) return envFallback();
    return resolveFromRow(row);
}

/**
 * Read only explicit dashboard values. Unlike fetchDashboardCarbonContext,
 * this does not blend in the deployment default, allowing callers to apply
 * the documented dashboard > factor store > deployment precedence.
 */
export async function fetchDashboardCarbonOverrides(
    dashboardId: number | null | undefined,
    orgId: string
): Promise<DashboardCarbonOverrides> {
    if (!isValidDashboardId(dashboardId)) return emptyOverrides();
    if (!(await dashboardBelongsToOrg(dashboardId, orgId))) {
        return emptyOverrides();
    }
    const row = await fetchRowBestEffort(dashboardId);
    if (!row) return emptyOverrides();
    return {
        lbmGPerKWh: isPositiveFinite(row.emission_factor_g_per_kwh)
            ? row.emission_factor_g_per_kwh
            : null,
        mbmGPerKWh: isPositiveFinite(row.emission_factor_mbm_g_per_kwh)
            ? row.emission_factor_mbm_g_per_kwh
            : null,
        budgetKg: isPositiveFinite(row.co2_budget_kg) ? row.co2_budget_kg : null
    };
}

function isValidDashboardId(id: unknown): id is number {
    return typeof id === 'number' && Number.isFinite(id) && id > 0;
}

function envFallback(): DashboardCarbonContext {
    return {
        lbmGPerKWh: tuning.energy.emissionFactorLbmGPerKWh,
        mbmGPerKWh: null,
        budgetKg: null,
        source: 'env_default'
    };
}

function emptyOverrides(): DashboardCarbonOverrides {
    return {lbmGPerKWh: null, mbmGPerKWh: null, budgetKg: null};
}

async function fetchRowBestEffort(dashboardId: number): Promise<Row | null> {
    try {
        const rows = await PostgresProvider.queryRows<Row>(
            `SELECT emission_factor_g_per_kwh,
                    emission_factor_mbm_g_per_kwh,
                    co2_budget_kg
             FROM ui.dashboard_settings WHERE dashboard_id = $1`,
            [dashboardId]
        );
        return rows[0] ?? null;
    } catch (err) {
        logger.warn(
            'carbon context fetch failed; using env defaults: %s',
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

export function resolveFromRow(row: Row): DashboardCarbonContext {
    // LBM, MBM and budget are independent columns. A blank LBM falls back to the
    // env default but must not discard a user's MBM factor or CO2 budget.
    const lbm = isPositiveFinite(row.emission_factor_g_per_kwh)
        ? row.emission_factor_g_per_kwh
        : tuning.energy.emissionFactorLbmGPerKWh;
    return {
        lbmGPerKWh: lbm,
        mbmGPerKWh: isPositiveFinite(row.emission_factor_mbm_g_per_kwh)
            ? row.emission_factor_mbm_g_per_kwh
            : null,
        budgetKg: isPositiveFinite(row.co2_budget_kg)
            ? row.co2_budget_kg
            : null,
        source: 'dashboard'
    };
}

function isPositiveFinite(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value > 0;
}
