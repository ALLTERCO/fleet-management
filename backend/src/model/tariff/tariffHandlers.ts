/**
 * Pure handlers for the `Tariff.*` namespace.
 *
 * Extracted from TariffComponent so unit tests can exercise the logic
 * without importing the Component base class. The component methods
 * become one-line adapters.
 */

import {
    createRawIngressToken,
    hashIngressToken
} from '../../modules/deviceIngress/tokenHash.js';
import {isValidTimezone} from '../../modules/location/isoData.js';
import type {LiveTariffRepository} from '../../modules/repositories/LiveTariffRepository.js';
import type {TariffRepository} from '../../modules/repositories/TariffRepository.js';
import RpcError from '../../rpc/RpcError.js';
import {validateOrThrow} from '../../rpc/validateOrThrow.js';
import {parseDateRange} from '../../rpc/validation.js';
import {isSupportedCurrency} from '../../types/api/_currency.js';
import {
    TARIFF_ASSIGNMENT_SCHEMA,
    TARIFF_BILLING_PERIOD_AT_SCHEMA,
    TARIFF_BILLING_PERIODS_MAX_RANGE_MS,
    TARIFF_BILLING_PERIODS_SCHEMA,
    TARIFF_EMPTY_PARAMS_SCHEMA,
    TARIFF_RESOLVE_ASSIGNMENTS_SCHEMA,
    TARIFF_RESOLVE_PRICING_SCHEMA,
    TARIFF_SET_LIVE_SOURCE_SCHEMA,
    TARIFF_SPEC_SCHEMA,
    TARIFF_WRITE_COMPONENTS_SCHEMA,
    type TariffAssignmentSpec,
    type TariffCurrentPricing,
    type TariffPriceComponentSpec,
    type TariffPricingPoint,
    type TariffResolutionPoint,
    type TariffSpec
} from '../../types/api/tariff.js';
import {parseDateParam} from '../component/readQuerySupport.js';
import {
    billingPeriodBounds,
    billingPeriodCalendarKey,
    billingPeriodDays,
    billingPeriodIndexAt
} from '../report/reportPeriod.js';
import {
    tariffBilledUnit,
    tariffCommodity,
    tariffQuantityMetric
} from '../report/tariffQuantity.js';
import {
    resolveTariffPricing,
    tariffContractCovers
} from '../report/tariffResolver.js';
import {assertTariffCoverage} from './tariffCoverage.js';

/**
 * Minimal sender contract — structural so tests can pass a plain object
 * without importing the full CommandSender class.
 */
export interface TariffSenderCapabilities {
    getOrganizationId(): string | undefined;
}

export interface TariffPricingReader {
    resolveAssignments(
        org: string,
        points: readonly TariffResolutionPoint[]
    ): Promise<Awaited<ReturnType<TariffRepository['resolveAssignments']>>>;
    get(org: string, id: number): Promise<TariffSpec | null>;
}

function requireOrg(sender: TariffSenderCapabilities): string {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    return org;
}

// A tariff prices day/night and seasons in its own zone; an invalid zone would
// silently fall back to UTC and misprice. Reject it at write time.
function assertValidTimezone(spec: TariffSpec): void {
    if (!isValidTimezone(spec.timezone)) {
        throw RpcError.InvalidParams(
            `timezone '${spec.timezone}' is not a valid IANA zone`
        );
    }
}

function assertValidCurrency(spec: TariffSpec): void {
    if (!isSupportedCurrency(spec.currency)) {
        throw RpcError.InvalidParams(
            `currency '${spec.currency}' is not a supported ISO 4217 code`
        );
    }
}

function assertValidContract(spec: TariffSpec): void {
    if (
        spec.effectiveFrom &&
        spec.effectiveTo &&
        spec.effectiveFrom > spec.effectiveTo
    ) {
        throw RpcError.InvalidParams(
            'effectiveFrom must be on or before effectiveTo'
        );
    }
    const demand = spec.demand;
    if (!demand) return;
    if (demand.seasons.length === 0) {
        throw RpcError.InvalidParams(
            'demand.seasons must cover the demand charging periods'
        );
    }
}

export function assertValidCommodityUnit(spec: TariffSpec): void {
    const commodity = tariffCommodity(spec);
    const billedUnit = tariffBilledUnit(spec);
    if (!tariffQuantityMetric(spec)) {
        throw RpcError.InvalidParams(
            `billedUnit '${billedUnit}' is not supported for commodity '${commodity}'`
        );
    }
    if (spec.blocks && spec.blocks.unit !== billedUnit) {
        throw RpcError.InvalidParams(
            `blocks.unit '${spec.blocks.unit}' must equal billedUnit '${billedUnit}'`
        );
    }
    if (spec.blocks && tariffQuantityMetric(spec)?.requiresConversion) {
        throw RpcError.InvalidParams(
            'converted gas tariffs cannot use period blocks until converted history is available'
        );
    }
    if (commodity !== 'electricity' && (spec.demand || spec.demandRate)) {
        throw RpcError.InvalidParams(
            'demand charges currently require commodity electricity'
        );
    }
}

/** Cross-rule checks that JSON Schema cannot express. */
export function assertValidTaxes(spec: TariffSpec): void {
    if (spec.taxes == null) return;
    const priorCodes = new Set<string>();
    for (const [index, tax] of spec.taxes.entries()) {
        const position = `taxes[${index}]`;
        if (tax.name.trim().length === 0) {
            throw RpcError.InvalidParams(`${position}.name must not be blank`);
        }
        if (priorCodes.has(tax.code)) {
            throw RpcError.InvalidParams(
                `${position}.code '${tax.code}' must be unique`
            );
        }
        if (!tax.exempt && tax.ratePct > 0 && tax.appliesTo.length === 0) {
            throw RpcError.InvalidParams(
                `${position}.appliesTo must contain at least one charge basis for an active tax`
            );
        }
        if (tax.calculation === 'inclusive' && tax.exempt) {
            throw RpcError.InvalidParams(
                `${position} cannot be both inclusive and exempt; exempt rules must be exclusive`
            );
        }
        if (
            tax.calculation === 'inclusive' &&
            (tax.compoundOn?.length ?? 0) > 0
        ) {
            throw RpcError.InvalidParams(
                `${position}.compoundOn must be empty for an inclusive tax`
            );
        }
        for (const compoundCode of tax.compoundOn ?? []) {
            if (!priorCodes.has(compoundCode)) {
                throw RpcError.InvalidParams(
                    `${position}.compoundOn '${compoundCode}' must reference an earlier tax code`
                );
            }
        }
        priorCodes.add(tax.code);
    }
}

export function assertValidComponents(
    components: readonly TariffPriceComponentSpec[]
): void {
    const codes = new Set<string>();
    const sequences = new Set<number>();
    const ordered = [...components].sort(
        (left, right) => left.sequence - right.sequence
    );
    for (const [index, component] of ordered.entries()) {
        const position = `components[${index}]`;
        if (!component.name.trim()) {
            throw RpcError.InvalidParams(`${position}.name must not be blank`);
        }
        if (codes.has(component.code)) {
            throw RpcError.InvalidParams(
                `${position}.code '${component.code}' must be unique`
            );
        }
        if (sequences.has(component.sequence)) {
            throw RpcError.InvalidParams(
                `${position}.sequence ${component.sequence} must be unique`
            );
        }
        if (
            component.effectiveFrom &&
            component.effectiveTo &&
            component.effectiveFrom > component.effectiveTo
        ) {
            throw RpcError.InvalidParams(
                `${position}.effectiveFrom must be on or before effectiveTo`
            );
        }
        const expectedBasis = COMPONENT_BASIS_BY_TYPE[component.chargeType];
        if (component.basis !== expectedBasis) {
            throw RpcError.InvalidParams(
                `${position}.basis must be '${expectedBasis}' for ${component.chargeType}`
            );
        }
        if (
            component.chargeClass === 'tax' &&
            component.chargeType !== 'percentage'
        ) {
            throw RpcError.InvalidParams(
                `${position} tax lines must use percentage calculation`
            );
        }
        const appliesTo = component.appliesTo ?? [];
        if (
            (component.chargeType === 'percentage' ||
                component.chargeType === 'minimum') &&
            appliesTo.length === 0
        ) {
            throw RpcError.InvalidParams(
                `${position}.appliesTo must name earlier lines`
            );
        }
        for (const code of appliesTo) {
            if (!codes.has(code) && !LEGACY_COMPONENT_CODES.has(code)) {
                throw RpcError.InvalidParams(
                    `${position}.appliesTo '${code}' must reference an earlier component or legacy line`
                );
            }
        }
        codes.add(component.code);
        sequences.add(component.sequence);
    }
}

const LEGACY_COMPONENT_CODES = new Set([
    'legacy_energy',
    'legacy_demand',
    'legacy_standing'
]);

const COMPONENT_BASIS_BY_TYPE: Record<
    TariffPriceComponentSpec['chargeType'],
    TariffPriceComponentSpec['basis']
> = {
    per_unit: 'consumption',
    fixed_day: 'standing',
    fixed_month: 'standing',
    percentage: 'subtotal',
    minimum: 'subtotal'
};

export async function handleTariffList(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    validateOrThrow<Record<string, never>>(
        params ?? {},
        TARIFF_EMPTY_PARAMS_SCHEMA
    );
    const org = requireOrg(sender);
    const items = await repo.list(org);
    return {
        items: items.map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            currency: item.currency,
            commodity: item.commodity,
            billedUnit: item.billed_unit,
            effectiveFrom: item.effective_from,
            effectiveTo: item.effective_to,
            sourceReference: item.source_reference
        }))
    };
}

export async function handleTariffGet(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{id: number}>(params, {
        type: 'object',
        required: ['id'],
        properties: {id: {type: 'integer', minimum: 1}}
    });
    const tariff = await repo.get(org, p.id);
    if (!tariff) throw RpcError.NotFound('tariff', p.id);
    return {tariff};
}

/**
 * The billing periods a window touches, on the tariff's own anchor. A demand
 * charge is scoped to a billing month, not a calendar one, and the anchor is
 * `billingDay` in the tariff's `timezone` — which is not a fixed UTC offset in
 * any zone that observes daylight saving. Answering it here means a caller
 * never derives it from a clock.
 */
export async function handleTariffBillingPeriods(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{tariffId: number; from: string; to: string}>(
        params,
        TARIFF_BILLING_PERIODS_SCHEMA
    );
    const {from, to} = parseDateRange(
        p.from,
        p.to,
        TARIFF_BILLING_PERIODS_MAX_RANGE_MS
    );
    const tariff = await repo.get(org, p.tariffId);
    if (!tariff) throw RpcError.NotFound('tariff', p.tariffId);
    return {items: billingPeriodsBetween(tariff, from, to)};
}

export async function handleTariffBillingPeriodAt(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{tariffId: number; at: string}>(
        params,
        TARIFF_BILLING_PERIOD_AT_SCHEMA
    );
    const at = parseDateParam(p.at, 'at', {required: true});
    const tariff = await repo.get(org, p.tariffId);
    if (!tariff) throw RpcError.NotFound('tariff', p.tariffId);
    const currentIndex = billingPeriodIndexAt(
        at as Date,
        tariff.timezone,
        tariff.billingDay
    );
    return {
        current: billingPeriodAtIndex(tariff, currentIndex),
        previous: billingPeriodAtIndex(tariff, currentIndex - 1)
    };
}

/** Half-open: a window ending exactly on an anchor does not touch the period
 * that anchor opens. */
function billingPeriodsBetween(tariff: TariffSpec, from: Date, to: Date) {
    const {timezone, billingDay} = tariff;
    const first = billingPeriodIndexAt(from, timezone, billingDay);
    const last = billingPeriodIndexAt(
        new Date(to.getTime() - 1),
        timezone,
        billingDay
    );
    const items = [];
    for (let index = first; index <= last; index += 1) {
        items.push(billingPeriodAtIndex(tariff, index));
    }
    return items;
}

function billingPeriodAtIndex(tariff: TariffSpec, index: number) {
    const bounds = billingPeriodBounds(
        index,
        tariff.billingDay,
        tariff.timezone
    );
    return {
        key: billingPeriodCalendarKey(index),
        from: bounds.from.toISOString(),
        to: bounds.to.toISOString(),
        days: billingPeriodDays(index, tariff.billingDay)
    };
}

export async function handleTariffListAssignments(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    validateOrThrow<Record<string, never>>(
        params ?? {},
        TARIFF_EMPTY_PARAMS_SCHEMA
    );
    const org = requireOrg(sender);
    const rows = await repo.listAssignments(org);
    return {
        items: rows.map((row) => ({
            tariffId: row.tariff_id,
            scopeLevel: row.scope_level,
            dashboardId: row.dashboard_id,
            locationId: row.location_id,
            deviceExternalId: row.device_external_id,
            channel: row.channel,
            commodity: row.commodity ?? 'electricity',
            billedUnit: row.billed_unit ?? 'kWh',
            direction: row.direction ?? 'import'
        }))
    };
}

export async function handleTariffResolveAssignments(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const p = validateOrThrow<{points: TariffResolutionPoint[]}>(
        params,
        TARIFF_RESOLVE_ASSIGNMENTS_SCHEMA
    );
    const org = requireOrg(sender);
    return {items: await repo.resolveAssignments(org, p.points)};
}

export async function handleTariffResolvePricing(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffPricingReader
): Promise<TariffCurrentPricing> {
    const p = validateOrThrow<TariffPricingPoint>(
        params,
        TARIFF_RESOLVE_PRICING_SCHEMA
    );
    const at = parseDateParam(p.at, 'at', {required: true});
    if (!at) throw RpcError.InvalidParams('"at" is required');
    const org = requireOrg(sender);
    const point: TariffResolutionPoint = {
        deviceExternalId: p.deviceExternalId,
        channel: p.channel,
        commodity: p.commodity,
        direction: p.direction
    };
    const [resolution] = await repo.resolveAssignments(org, [point]);
    const resolved = resolution ?? {
        deviceExternalId: p.deviceExternalId,
        channel: p.channel,
        commodity: p.commodity ?? 'electricity',
        direction: p.direction ?? 'import',
        tariffId: null,
        scopeLevel: null,
        locationId: null,
        ambiguous: false
    };
    const base = {
        at: at.toISOString(),
        deviceExternalId: resolved.deviceExternalId,
        channel: resolved.channel,
        commodity: resolved.commodity,
        direction: resolved.direction,
        tariffId: resolved.tariffId,
        scopeLevel: resolved.scopeLevel,
        locationId: resolved.locationId,
        ambiguous: resolved.ambiguous
    };
    if (resolved.ambiguous) {
        return {
            ...base,
            tariff: null,
            pricing: null,
            unavailableReason: 'ambiguous_assignment' as const
        };
    }
    if (resolved.tariffId == null) {
        return {
            ...base,
            tariff: null,
            pricing: null,
            unavailableReason: 'no_tariff_assignment' as const
        };
    }
    const tariff = await repo.get(org, resolved.tariffId);
    if (!tariff) {
        return {
            ...base,
            tariff: null,
            pricing: null,
            unavailableReason: 'tariff_not_found' as const
        };
    }
    const tariffSummary = {
        kind: tariff.kind,
        currency: tariff.currency,
        billedUnit: tariffBilledUnit(tariff),
        timezone: tariff.timezone
    };
    const contractCovers = tariffContractCovers(tariff, at);
    if (!contractCovers) {
        return {
            ...base,
            tariff: tariffSummary,
            pricing: null,
            unavailableReason: 'outside_effective_dates' as const
        };
    }
    if (tariff.kind === 'live') {
        return {
            ...base,
            tariff: tariffSummary,
            pricing: null,
            unavailableReason: 'live_price_requires_feed' as const
        };
    }
    if (tariff.kind === 'block') {
        return {
            ...base,
            tariff: tariffSummary,
            pricing: null,
            unavailableReason: 'block_requires_period_usage' as const
        };
    }
    const pricing = resolveTariffPricing(tariff, at);
    if (pricing) {
        return {
            ...base,
            tariff: tariffSummary,
            pricing: {price: pricing.price, band: pricing.band},
            unavailableReason: null
        };
    }
    return {
        ...base,
        tariff: tariffSummary,
        pricing: null,
        unavailableReason: 'no_matching_window' as const
    };
}

export async function handleTariffAdd(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const spec = validateOrThrow<TariffSpec>(params, TARIFF_SPEC_SCHEMA);
    assertValidTimezone(spec);
    assertValidCurrency(spec);
    assertValidContract(spec);
    assertValidCommodityUnit(spec);
    assertValidTaxes(spec);
    assertValidComponents(spec.components ?? []);
    assertTariffCoverage(spec);
    return {id: await repo.upsert(org, spec)};
}

export async function handleTariffUpdate(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{id: number} & TariffSpec>(params, {
        type: 'object',
        required: ['id', ...(TARIFF_SPEC_SCHEMA.required as string[])],
        properties: {
            id: {type: 'integer', minimum: 1},
            ...(TARIFF_SPEC_SCHEMA.properties as object)
        }
    });
    const {id, ...rest} = p;
    const spec: TariffSpec = {...rest, id};
    assertValidTimezone(spec);
    assertValidCurrency(spec);
    assertValidContract(spec);
    assertValidCommodityUnit(spec);
    assertValidTaxes(spec);
    assertValidComponents(spec.components ?? []);
    assertTariffCoverage(spec);
    return {id: await repo.upsert(org, spec)};
}

export async function handleTariffWriteComponents(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{
        tariffId: number;
        components: TariffPriceComponentSpec[];
    }>(params, TARIFF_WRITE_COMPONENTS_SCHEMA);
    assertValidComponents(p.components);
    const tariff = await repo.get(org, p.tariffId);
    if (!tariff) throw RpcError.NotFound('tariff', p.tariffId);
    await repo.writeComponents(org, p.tariffId, p.components);
    return {ok: true};
}

export async function handleTariffDelete(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{id: number}>(params, {
        type: 'object',
        required: ['id'],
        properties: {id: {type: 'integer', minimum: 1}}
    });
    return {deleted: await repo.delete(org, p.id)};
}

export async function handleTariffAssign(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<TariffAssignmentSpec>(
        params,
        TARIFF_ASSIGNMENT_SCHEMA
    );
    const {delete: del = false, ...spec} = p;
    await repo.assign(org, spec, del);
    return {ok: true};
}

export async function handleTariffSetLiveSource(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository,
    liveRepo: LiveTariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{
        tariffId: number;
        mode: 'push' | 'pull';
        provider?: string;
        providerConfig?: unknown;
    }>(params, TARIFF_SET_LIVE_SOURCE_SCHEMA);

    const tariff = await repo.get(org, p.tariffId);
    if (!tariff) throw RpcError.NotFound('tariff', p.tariffId);

    if (p.mode === 'push') {
        const {token} = createRawIngressToken();
        const hash = hashIngressToken(token);
        await liveRepo.upsertSource({
            tariffId: p.tariffId,
            mode: 'push',
            pushTokenHash: hash,
            provider: null,
            providerConfig: null
        });
        return {token, url: `/api/tariff/live/${token}`};
    }

    await liveRepo.upsertSource({
        tariffId: p.tariffId,
        mode: 'pull',
        provider: p.provider ?? null,
        providerConfig: p.providerConfig ?? null
    });
    return {ok: true};
}
