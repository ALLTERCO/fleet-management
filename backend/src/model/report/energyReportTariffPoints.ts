// Per-channel tariff pricing: a Shelly Pro 3EM in monophase profile can have a
// different tariff on each channel. Resolves each (device, channel) to its
// most-specific tariff (channel > device > dashboard default) and prices it.

import {defaultLiveTariffRepository} from '../../modules/repositories/LiveTariffRepository';
import {defaultTariffRepository} from '../../modules/repositories/TariffRepository';
import RpcError from '../../rpc/RpcError';
import type {
    TariffResolutionPoint,
    TariffResolvedAssignment,
    TariffSpec
} from '../../types/api/tariff';
import type {
    BucketPricing,
    CostPriceResolver,
    Energy15minCostRow
} from './energyCostEngine';
import {
    blockAccumulationStart,
    type LivePricePoint,
    type LiveSeries,
    resolveBucketPricing,
    sortLiveSeries
} from './energyReportCost';
import {isDayHour, type RateContext, resolveEnergyRate} from './rowEconomics';
import {
    type BlockPriceIndex,
    blockBucketsFromRows,
    buildBlockPriceIndex
} from './tariffBlockCharges';
import {
    type TariffQuantityMetric,
    tariffQuantityMetric
} from './tariffQuantity';
import {tariffContractCovers} from './tariffResolver';

// Minimal reader seams so tests can inject pool-backed stubs.
export interface TariffReader {
    resolveAssignments(
        org: string,
        points: readonly TariffResolutionPoint[]
    ): Promise<TariffResolvedAssignment[]>;
    get(org: string, id: number): Promise<TariffSpec | null>;
}
export interface LivePriceReader {
    getPrices(
        tariffId: number,
        from: Date,
        to: Date
    ): Promise<LivePricePoint[]>;
}

export interface PerPointResolverRequest {
    orgId: string;
    deviceMap: Map<number, string>; // internal id -> external (shelly) id
    defaultTariff: TariffSpec | null; // dashboard/explicit tariff, the fallback
    from: Date;
    to: Date;
    rate: RateContext; // day/night boundary for live-tariff buckets
    tariffRepo?: TariffReader;
    liveRepo?: LivePriceReader;
    /**
     * Fail when an assignment points at a tariff that no longer exists.
     * Reports retain their legacy fallback behaviour; read APIs that present
     * authoritative pricing enable this so stale configuration is visible.
     */
    strictAssignments?: boolean;
    /** Export pricing supplies a separate tariff and must not reuse import assignments. */
    includeAssignments?: boolean;
    /** Exact device/channel points present in the energy rows. */
    points?: readonly TariffResolutionPoint[];
    /**
     * The 15-minute rows this plan will price. Block tariffs bill cumulative
     * period usage, so they need the whole set up front, not row by row.
     */
    rows?: readonly Energy15minCostRow[];
    /** The commodity/unit of every row in this pricing pass. */
    quantityMetric?: TariffQuantityMetric;
    /**
     * Reads rows earlier than `from`. A block tariff whose report starts
     * mid-period needs the period-to-date usage before it, or the blocks
     * restart at zero and the period is undercharged.
     */
    loadHistory?: (
        from: Date,
        to: Date
    ) => Promise<readonly Energy15minCostRow[]>;
}

export type PerPointTariffSource =
    | 'channel-assignment'
    | 'device-assignment'
    | 'location-assignment'
    | 'organization-assignment'
    | 'fallback'
    | 'unconfigured';

export interface PerPointTariffResolution {
    tariff: TariffSpec | null;
    pricing: BucketPricing | null;
    source: PerPointTariffSource;
}

export interface PerPointPricingPlan {
    /** True when at least one device/channel assignment applies to this scope. */
    hasAssignments: boolean;
    resolve(row: Parameters<CostPriceResolver>[0]): PerPointTariffResolution;
}

/**
 * Loads the same tariff assignment and live-price state used by reports, but
 * keeps uncovered rows explicit. Energy.Query uses this plan to report partial
 * coverage instead of turning an absent tariff into a zero price.
 */
export async function buildPerPointPricingPlan(
    req: PerPointResolverRequest
): Promise<PerPointPricingPlan> {
    const tariffRepo = req.tariffRepo ?? (await defaultTariffRepository());
    const resolved =
        req.includeAssignments === false || !req.points?.length
            ? []
            : await tariffRepo.resolveAssignments(req.orgId, req.points);
    // Direction is part of the pricing identity. Older readers/fakes that omit
    // it are import-only; they must never become an accidental feed-in tariff.
    const resolutions = resolved.filter((resolution) => {
        const direction = resolution.direction ?? 'import';
        return req.points?.some(
            (point) =>
                point.deviceExternalId === resolution.deviceExternalId &&
                point.channel === resolution.channel &&
                (point.direction ?? 'import') === direction
        );
    });
    const specs = await loadTariffs(tariffRepo, req.orgId, resolutions);
    if (req.strictAssignments) {
        const missing = resolutions.find(
            (resolution) =>
                resolution.tariffId != null && !specs.has(resolution.tariffId)
        );
        if (missing) {
            throw RpcError.NotFound('tariff', String(missing.tariffId));
        }
    }
    const liveSeries = await loadLiveSeries({
        req,
        tariffs: [...specs.values(), req.defaultTariff].filter(
            (t): t is TariffSpec => t !== null
        )
    });
    const selectTariff = (row: Energy15minCostRow) =>
        selectPointTariff(req, resolutions, specs, row);
    const blockIndexes = await buildPointBlockIndexes({
        req,
        selectTariff
    });

    return {
        hasAssignments: resolutions.some(
            (resolution) => resolution.tariffId != null
        ),
        resolve(row) {
            const selection = selectTariff(row);
            if (!selection.tariff) {
                return {
                    tariff: null,
                    pricing: null,
                    source: 'unconfigured'
                };
            }
            const series =
                (selection.tariff.id != null &&
                    liveSeries.get(selection.tariff.id)) ||
                [];
            return {
                ...selection,
                pricing: resolveBucketPricing(selection.tariff, row.bucket, {
                    series,
                    rate: {...req.rate, timezone: selection.tariff.timezone},
                    blocks: blockIndexes.get(selection.tariff) ?? null
                })
            };
        }
    };
}

/**
 * Most-specific tariff for a row and where it came from. Shared by the block
 * pre-pass and the per-row resolve so both partition the rows identically.
 */
function selectPointTariff(
    req: PerPointResolverRequest,
    resolutions: readonly TariffResolvedAssignment[],
    specs: ReadonlyMap<number, TariffSpec>,
    row: Energy15minCostRow
): {tariff: TariffSpec | null; source: PerPointTariffSource} {
    const ext = req.deviceMap.get(row.device) ?? '';
    const resolution = resolutions.find(
        (item) => item.deviceExternalId === ext && item.channel === row.channel
    );
    const tariff =
        resolution && !resolution.ambiguous && resolution.tariffId != null
            ? (specs.get(resolution.tariffId) ?? null)
            : resolution?.ambiguous
              ? null
              : req.defaultTariff;
    if (!tariff) return {tariff: null, source: 'unconfigured'};
    if (req.quantityMetric) {
        assertTariffPricesMetric(tariff, req.quantityMetric);
    }
    return {
        tariff,
        source: resolution?.scopeLevel
            ? (`${resolution.scopeLevel}-assignment` as PerPointTariffSource)
            : 'fallback'
    };
}

function assertTariffPricesMetric(
    tariff: TariffSpec,
    requested: TariffQuantityMetric
): void {
    const configured = tariffQuantityMetric(tariff);
    if (
        !configured ||
        configured.commodity !== requested.commodity ||
        (configured.billedUnit !== requested.billedUnit &&
            !(
                requested.commodity === 'gas' &&
                configured.requiresConversion === 'gas'
            ))
    ) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Tariff ${tariff.id ?? '(unsaved)'} does not price ` +
                `${requested.commodity} in ${requested.billedUnit}.`,
            field: 'tariff.billedUnit'
        });
    }
}

/**
 * One block index per block tariff in play, built from the rows that tariff
 * actually prices. Each tariff carries its own zone and billing day, so the
 * history read reaches back to the earliest anchor among them and every index
 * then groups by its own period.
 */
async function buildPointBlockIndexes(input: {
    req: PerPointResolverRequest;
    selectTariff: (row: Energy15minCostRow) => {tariff: TariffSpec | null};
}): Promise<Map<TariffSpec, BlockPriceIndex>> {
    const {req} = input;
    const rows = req.rows ?? [];
    const blockTariffs = new Set<TariffSpec>();
    for (const row of rows) {
        const {tariff} = input.selectTariff(row);
        if (tariff?.kind === 'block' && tariff.blocks) blockTariffs.add(tariff);
    }
    const indexes = new Map<TariffSpec, BlockPriceIndex>();
    if (blockTariffs.size === 0) return indexes;

    const anchor = [...blockTariffs]
        .map((tariff) => blockAccumulationStart(tariff, req.from))
        .reduce((earliest, at) => (at < earliest ? at : earliest));
    const history =
        anchor < req.from && req.loadHistory
            ? await req.loadHistory(anchor, req.from)
            : [];
    const allRows = [...history, ...rows];

    for (const tariff of blockTariffs) {
        const owned = allRows.filter(
            (row) => input.selectTariff(row).tariff === tariff
        );
        indexes.set(
            tariff,
            buildBlockPriceIndex({
                blocks: tariff.blocks!,
                timezone: tariff.timezone,
                billingDay: tariff.billingDay,
                buckets: blockBucketsFromRows(owned, (at) =>
                    tariffContractCovers(tariff, at)
                )
            })
        );
    }
    return indexes;
}

// Returns a resolver when device/channel assignments exist, else null (the
// caller then uses the single default tariff path).
export async function buildPerPointResolver(
    req: PerPointResolverRequest
): Promise<CostPriceResolver | null> {
    const plan = await buildPerPointPricingPlan(req);
    if (!plan.hasAssignments) return null;

    return (row): BucketPricing => {
        const resolved = plan.resolve(row);
        if (!resolved.pricing) {
            // No assignment and no default tariff — bill at the report's inline
            // rate (the legacy path), never a silent €0.
            const at = new Date(row.bucket);
            return {
                price: resolveEnergyRate(at, req.rate),
                isDay: isDayHour(at, req.rate)
            };
        }
        return resolved.pricing;
    };
}

async function loadTariffs(
    repo: TariffReader,
    orgId: string,
    resolutions: readonly TariffResolvedAssignment[]
): Promise<Map<number, TariffSpec>> {
    const out = new Map<number, TariffSpec>();
    for (const id of new Set(
        resolutions
            .map((resolution) => resolution.tariffId)
            .filter((id): id is number => id != null)
    )) {
        const t = await repo.get(orgId, id);
        if (t) out.set(id, t);
    }
    return out;
}

type LiveSeriesMap = Map<number, LiveSeries>;

async function loadLiveSeries(input: {
    req: PerPointResolverRequest;
    tariffs: readonly TariffSpec[];
}): Promise<LiveSeriesMap> {
    const out: LiveSeriesMap = new Map();
    const liveRepo =
        input.req.liveRepo ?? (await defaultLiveTariffRepository());
    for (const t of input.tariffs) {
        if (t.kind === 'live' && typeof t.id === 'number' && !out.has(t.id)) {
            const prices = await liveRepo.getPrices(
                t.id,
                input.req.from,
                input.req.to
            );
            out.set(t.id, sortLiveSeries(prices));
        }
    }
    return out;
}
