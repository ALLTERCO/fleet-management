import {calculateEnergyQueryPricing} from '../../model/energy/queryPricing';
import {
    billingPeriodBounds,
    billingPeriodIndexAt
} from '../../model/report/reportPeriod';
import * as PostgresProvider from '../PostgresProvider';
import {
    defaultEnergyRepository,
    type EnergyRepository
} from '../repositories/EnergyRepository';
import type {LoadedAlertRule, MatchResult} from './types';

const MAX_PRICING_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CostBudgetConfig {
    budgetAmount: number;
    currency: string;
    period: 'billing_period';
    billingDay: number;
    thresholdPercentages: number[];
    timeZone: string;
}

export interface CostBudgetPeriod {
    from: Date;
    to: Date;
}

export interface CostBudgetSpend {
    actualCost: number;
    currency: string;
    period: CostBudgetPeriod;
}

type PricingCalculator = typeof calculateEnergyQueryPricing;

export interface CostBudgetSpendDeps {
    repo?: Pick<
        EnergyRepository,
        'queryEnergy15minByChannel' | 'resolveDeviceJoinDates'
    >;
    calculatePricing?: PricingCalculator;
}

/**
 * Runtime guard for rows that predate API validation or were written outside
 * the RPC path. V1 claims are keyed per rule/period, so a rule must resolve to
 * one explicit meter before the sweep may evaluate it.
 */
export function costBudgetTargetDeviceId(scope: unknown): string | null {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope))
        return null;
    const record = scope as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== 'deviceIds')) return null;
    const ids = record.deviceIds;
    if (!Array.isArray(ids) || ids.length !== 1) return null;
    const id = ids[0];
    return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

export function selectCostBudgetTargetDevice<T extends {shellyID: string}>(
    scope: unknown,
    devices: readonly T[]
): T[] | null {
    const target = costBudgetTargetDeviceId(scope);
    return target === null
        ? null
        : devices.filter((device) => device.shellyID === target);
}

export function costBudgetConfig(
    config: Record<string, unknown>
): CostBudgetConfig | null {
    const {
        budgetAmount,
        currency,
        period,
        billingDay,
        thresholdPercentages,
        timeZone
    } = config;
    if (
        typeof budgetAmount !== 'number' ||
        !Number.isFinite(budgetAmount) ||
        budgetAmount <= 0
    ) {
        return null;
    }
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        return null;
    }
    if (period !== 'billing_period') return null;
    if (
        !Number.isInteger(billingDay) ||
        Number(billingDay) < 1 ||
        Number(billingDay) > 28
    ) {
        return null;
    }
    if (typeof timeZone !== 'string' || timeZone.length === 0) return null;
    if (
        !Array.isArray(thresholdPercentages) ||
        thresholdPercentages.length === 0 ||
        thresholdPercentages.some(
            (value) =>
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value <= 0 ||
                value > 1000
        )
    ) {
        return null;
    }
    return {
        budgetAmount,
        currency,
        period,
        billingDay: Number(billingDay),
        thresholdPercentages: [
            ...new Set(thresholdPercentages.map((value) => +value.toFixed(2)))
        ].sort((left, right) => left - right),
        timeZone
    };
}

export function currentCostBudgetPeriod(
    now: Date,
    config: CostBudgetConfig
): CostBudgetPeriod {
    const index = billingPeriodIndexAt(now, config.timeZone, config.billingDay);
    // Period to date: the period's own opening, truncated at now.
    return {
        from: billingPeriodBounds(index, config.billingDay, config.timeZone)
            .from,
        to: now
    };
}

/**
 * Prices recorded AC-mains import from energy_15min through the same
 * assignment-aware pricing path as Energy.Query. No fallback tariff is
 * invented. Long calendar months are split only because the public pricing
 * path is deliberately capped at 30 days; each slice remains fail-closed.
 */
export async function readActualCostBudgetSpend(
    organizationId: string,
    device: {id: number; shellyID: string},
    now: Date,
    config: CostBudgetConfig,
    deps: CostBudgetSpendDeps = {}
): Promise<CostBudgetSpend | null> {
    const period = currentCostBudgetPeriod(now, config);
    if (period.to <= period.from) return null;
    const repo = deps.repo ?? (await defaultEnergyRepository());
    const calculate = deps.calculatePricing ?? calculateEnergyQueryPricing;
    let cursor = period.from;
    let actualCost = 0;
    let resolvedCurrency: string | null = null;

    while (cursor < period.to) {
        const end = new Date(
            Math.min(
                period.to.getTime(),
                cursor.getTime() + MAX_PRICING_RANGE_MS
            )
        );
        const pricing = await calculate(
            {
                from: cursor.toISOString(),
                to: end.toISOString(),
                tags: ['total_act_energy', 'total_act_ret_energy'],
                commodity: 'electricity',
                electricalSource: 'ac_mains',
                devices: [device.shellyID],
                pricing: {}
            },
            {
                getOrganizationId: () => organizationId,
                hasCrudPermission: () => true
            },
            repo,
            {
                internalIds: [device.id],
                idMap: {[device.id]: device.shellyID}
            }
        );
        if (
            pricing.status !== 'priced' ||
            pricing.energyCost === null ||
            pricing.currency === null
        ) {
            return null;
        }
        if (
            resolvedCurrency !== null &&
            pricing.currency !== resolvedCurrency
        ) {
            throw new Error(
                `cost budget period crosses tariff currencies ${resolvedCurrency} and ${pricing.currency}`
            );
        }
        resolvedCurrency = pricing.currency;
        actualCost += pricing.energyCost;
        cursor = end;
    }

    if (resolvedCurrency !== config.currency) {
        throw new Error(
            `cost budget currency ${config.currency} does not match tariff currency ${resolvedCurrency ?? 'unconfigured'}`
        );
    }
    return {
        actualCost: +actualCost.toFixed(2),
        currency: resolvedCurrency,
        period
    };
}

export function crossedCostBudgetThresholds(
    actualCost: number,
    config: CostBudgetConfig
): Array<{
    thresholdBps: number;
    thresholdPct: number;
    thresholdAmount: number;
}> {
    const out: Array<{
        thresholdBps: number;
        thresholdPct: number;
        thresholdAmount: number;
    }> = [];
    for (const configuredPct of config.thresholdPercentages) {
        const thresholdBps = Math.round(configuredPct * 100);
        const thresholdPct = thresholdBps / 100;
        const thresholdAmount = (config.budgetAmount * thresholdPct) / 100;
        if (actualCost + 1e-9 >= thresholdAmount) {
            out.push({thresholdBps, thresholdPct, thresholdAmount});
        }
    }
    return out;
}

interface ClaimRow {
    claimed: boolean;
}

export async function claimCostBudgetThreshold(input: {
    organizationId: string;
    ruleId: number;
    periodStart: Date;
    thresholdBps: number;
    actualCost: number;
    budgetAmount: number;
    currency: string;
}): Promise<boolean> {
    const rows = await PostgresProvider.queryRows<ClaimRow>(
        `WITH claimed AS (
             INSERT INTO notifications.cost_budget_period_fires (
                 organization_id, rule_id, period_start, threshold_bps,
                 actual_cost, budget_amount, currency
             )
             SELECT $1, $2, $3, $4, $5, $6, $7
               FROM notifications.alert_rules rule
              WHERE rule.organization_id = $1 AND rule.id = $2
                AND rule.kind = 'cost_budget_threshold'
                AND rule.enabled AND rule.deleted_at IS NULL
             ON CONFLICT DO NOTHING
             RETURNING 1
         )
         SELECT EXISTS (SELECT 1 FROM claimed) AS claimed`,
        [
            input.organizationId,
            input.ruleId,
            input.periodStart,
            input.thresholdBps,
            input.actualCost,
            input.budgetAmount,
            input.currency
        ]
    );
    return rows[0]?.claimed === true;
}

export async function releaseCostBudgetThresholdClaim(input: {
    organizationId: string;
    ruleId: number;
    periodStart: Date;
    thresholdBps: number;
}): Promise<void> {
    await PostgresProvider.queryRows(
        `DELETE FROM notifications.cost_budget_period_fires
          WHERE organization_id = $1 AND rule_id = $2
            AND period_start = $3 AND threshold_bps = $4`,
        [
            input.organizationId,
            input.ruleId,
            input.periodStart,
            input.thresholdBps
        ]
    );
}

export function costBudgetThresholdMatch(
    rule: LoadedAlertRule,
    device: {shellyID: string; info?: {name?: unknown}},
    config: CostBudgetConfig,
    spend: CostBudgetSpend,
    threshold: {
        thresholdBps: number;
        thresholdPct: number;
        thresholdAmount: number;
    }
): MatchResult {
    const configuredName = device.info?.name;
    const label =
        typeof configuredName === 'string' && configuredName.trim()
            ? configuredName.trim()
            : device.shellyID;
    return {
        fingerprintV2:
            `rule:${rule.id}:device:${device.shellyID}:period:` +
            `${spend.period.from.toISOString()}:threshold:${threshold.thresholdBps}`,
        title: `${label} reached ${threshold.thresholdPct}% of its energy-cost budget`,
        message:
            `${label} has ${spend.currency} ${spend.actualCost.toFixed(2)} in recorded import-energy charges ` +
            `this billing period, crossing ${threshold.thresholdPct}% of its ${spend.currency} ${config.budgetAmount.toFixed(2)} budget. ` +
            'Standing, demand and tax charges are not included.',
        subject: {type: 'device', id: device.shellyID},
        context: {
            shellyID: device.shellyID,
            actualCost: spend.actualCost,
            budgetAmount: config.budgetAmount,
            currency: spend.currency,
            thresholdPct: threshold.thresholdPct,
            thresholdAmount: +threshold.thresholdAmount.toFixed(2),
            period: config.period,
            periodStart: spend.period.from.toISOString(),
            periodEnd: spend.period.to.toISOString(),
            billingDay: config.billingDay,
            timeZone: config.timeZone,
            costBasis: 'recorded_import_energy_charge',
            excludedCharges: ['standing', 'demand', 'tax']
        }
    };
}
