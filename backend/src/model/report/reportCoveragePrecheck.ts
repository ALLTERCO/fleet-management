/**
 * Pre-flight coverage probe for a report request.
 *
 * A report job used to be created unconditionally and only discovered an empty
 * window minutes later, deep inside the engine. This is the cheap read that
 * settles the question first: two bounded aggregates over the 15-minute rollup,
 * no device, demand or artifact work. It probes the quantity the request asked
 * to be billed in, so an electricity-only fleet is refused a water report
 * instead of being handed a job that can only produce empty rows.
 */

import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import {readMeteredZeroRows} from '../billing/meteredZero';
import {
    type TariffQuantityMetric,
    tagsForQuantityMetric
} from './tariffQuantity';

export interface ReportCoverageProbe {
    repo: Pick<
        EnergyRepository,
        'queryChannelEnergyTotals' | 'queryOperationalMetric15minByChannel'
    >;
    internalIds: readonly number[];
    from: Date;
    to: Date;
    /** The stored quantity the report will read (raw, not billed). */
    metric: TariffQuantityMetric;
}

/** True when the scope has a rollup row, or a defensible measured zero. */
export async function hasRecordedReportData(
    probe: ReportCoverageProbe
): Promise<boolean> {
    if (probe.internalIds.length === 0) return false;
    const totals = await probe.repo.queryChannelEnergyTotals({
        internalIds: probe.internalIds,
        from: probe.from,
        to: probe.to,
        tags: tagsForQuantityMetric(probe.metric)
    });
    if (totals.length > 0) return true;
    // Electricity only: a powered meter whose lifetime counter did not advance
    // recorded the period, it just had nothing to write.
    const meteredZero = await readMeteredZeroRows({
        repo: probe.repo,
        internalIds: probe.internalIds,
        from: probe.from,
        to: probe.to,
        metric: probe.metric
    });
    return meteredZero.length > 0;
}

/**
 * Refuse a report the fleet has no readings for, before a job exists. The
 * caller gets the requested window and quantity back so the UI can say what was
 * looked at; `coveredFrom`/`coveredTo` are null because nothing in it was
 * covered.
 */
export async function assertRecordedReportData(
    probe: ReportCoverageProbe
): Promise<void> {
    if (await hasRecordedReportData(probe)) return;
    throw RpcError.Domain('NoRecordedData', {
        operation: 'report.generate',
        details: {
            requestedFrom: probe.from.toISOString(),
            requestedTo: probe.to.toISOString(),
            coveredFrom: null,
            coveredTo: null,
            commodity: probe.metric.commodity,
            billedUnit: probe.metric.billedUnit,
            devicesInScope: probe.internalIds.length
        }
    });
}
