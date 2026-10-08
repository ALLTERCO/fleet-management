import type {
    Energy15minByChannelRow,
    EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import type {TariffQuantityMetric} from '../report/tariffQuantity';

// Instantaneous AC tags a powered meter publishes every cycle, relay open or
// closed. Their presence is what separates "consumed nothing" from "said
// nothing".
const LIVENESS_TAGS = ['power', 'voltage'] as const;

// Any earlier bucket proves a counter reading existed before the period, so the
// lookup is open at the start. The totals read aggregates to one row per point.
const COUNTER_HISTORY_START = new Date(0);

export interface MeteredZeroRequest {
    repo: Pick<
        EnergyRepository,
        'queryChannelEnergyTotals' | 'queryOperationalMetric15minByChannel'
    >;
    internalIds: readonly number[];
    from: Date;
    to: Date;
    metric: TariffQuantityMetric;
}

/**
 * The zero-consumption readings a live meter really took.
 *
 * The 15-minute rollup stores an energy bucket only when the device's lifetime
 * counter moved, so a meter that is online, reporting, and consuming nothing
 * writes no energy row at all — by rows alone indistinguishable from a meter
 * that went silent. This is the single place that tells the two apart: a
 * counter reading before the period plus electrical liveness inside it means
 * the counter did not advance, which is a measured zero. A silent meter matches
 * neither test and gets no row back, so its caller keeps the no-data refusal.
 */
export async function readMeteredZeroRows(
    input: MeteredZeroRequest
): Promise<Energy15minByChannelRow[]> {
    if (input.metric.commodity !== 'electricity') return [];
    if (input.internalIds.length === 0) return [];
    const liveness = await input.repo.queryOperationalMetric15minByChannel({
        internalIds: input.internalIds,
        from: input.from,
        to: input.to,
        tags: LIVENESS_TAGS,
        commodity: 'electricity'
    });
    const liveDevices = [...new Set(liveness.map((sample) => sample.device))];
    if (liveDevices.length === 0) return [];
    const metered = await input.repo.queryChannelEnergyTotals({
        internalIds: liveDevices,
        from: COUNTER_HISTORY_START,
        to: input.from,
        tags: [input.metric.consumptionTag]
    });
    const bucket = input.from.toISOString();
    const readings: Energy15minByChannelRow[] = [];
    for (const point of metered) {
        if (point.channel === null) continue;
        readings.push({
            bucket,
            device: point.device,
            channel: point.channel,
            tag: input.metric.consumptionTag,
            energy_wh: 0
        });
    }
    return readings;
}

/**
 * Measured rows, or the zero readings a live meter can prove it took.
 *
 * An unchanged counter writes no bucket, so an empty read is the only point at
 * which a measured zero can still be told from a silent meter. Billing and
 * reporting both go through here, so neither can drift on when that question is
 * even asked: a period that recorded energy never consults the zero path.
 */
export async function meteredRowsOrZero(
    measured: Energy15minByChannelRow[],
    readZeroRows: () => Promise<Energy15minByChannelRow[]>
): Promise<Energy15minByChannelRow[]> {
    if (measured.length > 0) return measured;
    return readZeroRows();
}
