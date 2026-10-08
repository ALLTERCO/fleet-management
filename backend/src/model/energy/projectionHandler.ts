/**
 * Pure handler for `Energy.Projection`.
 *
 * The end-of-period run rate is computed in exactly one place —
 * `model/report/projection.ts`. Until now only the report job could reach it,
 * so dashboards grew their own rule. This handler reads the period's whole
 * days through the normal `Energy.Query` path (same scope resolution, same
 * authz, same scaling) and hands them to that one projector.
 */

import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ENERGY_PROJECTION_PARAMS_SCHEMA,
    type EnergyProjectionParams,
    type EnergyProjectionResponse,
    type EnergyQueryParams
} from '../../types/api/energy';
import {projectionRange, projectPeriodTotal} from '../report/projection';
import {handleEnergyQuery, type SenderCapabilities} from './queryHandler';

// Whole days are what the projector measures a pace from, and consumed active
// energy is what a period total means.
const PROJECTION_TAG = 'total_act_energy';
const PROJECTION_BUCKET = '1 day';

/** Nothing observed is not a pace of zero — see the guard below. */
const NOTHING_TO_PROJECT: EnergyProjectionResponse = {
    projectedKWh: 0,
    projectedCost: 0,
    confidenceBand: null,
    range: null,
    extrapolated: false,
    observedDays: 0,
    observedKWh: 0
};

export async function handleEnergyProjection(
    params: unknown,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    now: Date = new Date()
): Promise<EnergyProjectionResponse> {
    const validated = validateOrThrow<EnergyProjectionParams>(
        params,
        ENERGY_PROJECTION_PARAMS_SCHEMA
    );
    if (validated.scope !== undefined && validated.devices !== undefined) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }
    const from = new Date(validated.from);
    const to = new Date(validated.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw RpcError.InvalidParams('from and to must be ISO-8601 timestamps');
    }
    if (to.getTime() <= from.getTime()) {
        throw RpcError.InvalidParams('to must be after from');
    }

    // Read only what has already happened. Asking the store for buckets that
    // do not exist yet would fill the rest of the period with quiet days.
    const observedTo = new Date(Math.min(to.getTime(), now.getTime()));
    if (observedTo.getTime() <= from.getTime()) return NOTHING_TO_PROJECT;

    const query: EnergyQueryParams = {
        from: from.toISOString(),
        to: observedTo.toISOString(),
        tags: [PROJECTION_TAG],
        bucket: PROJECTION_BUCKET,
        perDevice: false,
        ...(validated.scope !== undefined ? {scope: validated.scope} : {}),
        ...(validated.devices !== undefined
            ? {devices: validated.devices}
            : {}),
        ...(validated.commodity !== undefined
            ? {commodity: validated.commodity}
            : {}),
        ...(validated.electricalSource !== undefined
            ? {electricalSource: validated.electricalSource}
            : {})
    };
    const page = await handleEnergyQuery(query, sender, repo);
    const series = page.items.map((row) => ({
        date: row.bucket,
        consumption_kwh: row.value
    }));
    const observedKWh = series.reduce((sum, r) => sum + r.consumption_kwh, 0);
    const observedDays = new Set(
        page.items.map((row) => row.bucket.slice(0, 10))
    ).size;

    // No readings at all is not a measured pace of zero. The projector's
    // no-series fallback would happily scale that zero across the period and
    // quote a stated band for it, which reads as a confident number the
    // readings never supported.
    if (observedDays === 0) return NOTHING_TO_PROJECT;

    const result = projectPeriodTotal({
        kwhSoFar: observedKWh,
        costSoFar: validated.costSoFar ?? 0,
        from,
        to,
        now,
        series,
        ...(validated.baselineKWhPerDay !== undefined
            ? {baselineKWhPerDay: validated.baselineKWhPerDay}
            : {})
    });

    return {
        projectedKWh: result.projectedKWh,
        projectedCost: result.projectedCost,
        confidenceBand: result.confidenceBand,
        range: projectionRange(result),
        extrapolated: result.extrapolated,
        observedDays,
        observedKWh
    };
}
