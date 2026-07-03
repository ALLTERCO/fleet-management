// Per-channel tariff pricing: a Shelly Pro 3EM in monophase profile can have a
// different tariff on each channel. Resolves each (device, channel) to its
// most-specific tariff (channel > device > dashboard default) and prices it.

import {defaultLiveTariffRepository} from '../../modules/repositories/LiveTariffRepository';
import {
    defaultTariffRepository,
    type TariffAssignmentRow
} from '../../modules/repositories/TariffRepository';
import type {TariffSpec} from '../../types/api/tariff';
import type {BucketPricing, CostPriceResolver} from './energyCostEngine';
import {
    type LivePricePoint,
    type LiveSeries,
    resolveBucketPricing,
    sortLiveSeries
} from './energyReportCost';
import {isDayHour, type RateContext, resolveEnergyRate} from './rowEconomics';

// Minimal reader seams so tests can inject pool-backed stubs.
export interface TariffReader {
    listAssignments(org: string): Promise<TariffAssignmentRow[]>;
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
}

// Returns a resolver when device/channel assignments exist, else null (the
// caller then uses the single default tariff path).
export async function buildPerPointResolver(
    req: PerPointResolverRequest
): Promise<CostPriceResolver | null> {
    const tariffRepo = req.tariffRepo ?? (await defaultTariffRepository());
    const assignments = (await tariffRepo.listAssignments(req.orgId)).filter(
        (a) => a.scope_level === 'device' || a.scope_level === 'channel'
    );
    if (assignments.length === 0) return null;

    const specs = await loadTariffs(tariffRepo, req.orgId, assignments);
    const liveSeries = await loadLiveSeries({
        req,
        tariffs: [...specs.values(), req.defaultTariff].filter(
            (t): t is TariffSpec => t !== null
        )
    });

    const pick = (ext: string, channel: number): TariffSpec | null =>
        pickAssignedTariff(assignments, specs, req.defaultTariff, ext, channel);

    return (row): BucketPricing => {
        const ext = req.deviceMap.get(row.device) ?? '';
        const tariff = pick(ext, row.channel);
        if (!tariff) {
            // No assignment and no default tariff — bill at the report's inline
            // rate (the legacy path), never a silent €0.
            const at = new Date(row.bucket);
            return {
                price: resolveEnergyRate(at, req.rate),
                isDay: isDayHour(at, req.rate)
            };
        }
        const series = (tariff.id != null && liveSeries.get(tariff.id)) || [];
        return resolveBucketPricing(tariff, row.bucket, {
            series,
            rate: req.rate
        });
    };
}

async function loadTariffs(
    repo: TariffReader,
    orgId: string,
    assignments: readonly TariffAssignmentRow[]
): Promise<Map<number, TariffSpec>> {
    const out = new Map<number, TariffSpec>();
    for (const id of new Set(assignments.map((a) => a.tariff_id))) {
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

function pickAssignedTariff(
    assignments: readonly TariffAssignmentRow[],
    specs: Map<number, TariffSpec>,
    fallback: TariffSpec | null,
    ext: string,
    channel: number
): TariffSpec | null {
    const channelMatch = assignments.find(
        (a) =>
            a.scope_level === 'channel' &&
            a.device_external_id === ext &&
            a.channel === channel
    );
    if (channelMatch) return specs.get(channelMatch.tariff_id) ?? fallback;
    const deviceMatch = assignments.find(
        (a) => a.scope_level === 'device' && a.device_external_id === ext
    );
    if (deviceMatch) return specs.get(deviceMatch.tariff_id) ?? fallback;
    return fallback;
}
