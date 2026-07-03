// Glue that asks the question "given this period's hourly load + grid carbon
// curve, what's the single best shift?". Returns null when nothing useful
// can be proposed (no data, no spread, no consumption in the worst hour).

import {HOURS_PER_DAY} from '../../modules/util/timeUnits';
import {getHourlyCarbonProvider} from './getHourlyCarbonProvider';
import type {HourlyCarbonPoint} from './hourlyCarbonProvider';
import {fetchHourlyProfile} from './hourlyProfileRepo';
import type {TimeShiftPlan} from './timeShiftRecommendation';
import {planTimeShift} from './timeShiftRecommendation';

export interface TimeShiftSuggestionInput {
    readonly deviceIds: readonly number[];
    readonly from: Date;
    readonly to: Date;
    readonly factorGPerKWh: number;
    readonly maxShiftableKWh: number;
    readonly carbon: {
        readonly zoneCode: string;
        readonly apiKey: string;
        readonly apiUrl: string;
        readonly timeoutMs: number;
    };
}

export async function suggestTimeShift(
    input: TimeShiftSuggestionInput
): Promise<TimeShiftPlan | null> {
    if (input.maxShiftableKWh <= 0) return null;
    const profile = await fetchHourlyProfile({
        deviceIds: input.deviceIds,
        from: input.from,
        to: input.to
    });
    const intensity = await loadIntensityCurve(input);
    return planTimeShift({
        hourlyConsumptionKWh: profile.consumedKWh,
        hourlyIntensityGPerKWh: intensity.curve,
        maxShiftableKWh: input.maxShiftableKWh,
        carbonDegraded: intensity.degraded
    });
}

interface IntensityCurve {
    readonly curve: number[];
    /** True when no real-time points returned — every hour was flat-filled. */
    readonly degraded: boolean;
}

async function loadIntensityCurve(
    input: TimeShiftSuggestionInput
): Promise<IntensityCurve> {
    const provider = getHourlyCarbonProvider({
        apiKey: input.carbon.apiKey,
        url: input.carbon.apiUrl,
        timeoutMs: input.carbon.timeoutMs,
        factorGPerKWh: input.factorGPerKWh
    });
    const points = await provider.fetchHourly({
        zoneCode: input.carbon.zoneCode,
        start: input.from.toISOString(),
        end: input.to.toISOString()
    });
    return {
        curve: foldByHourOfDay(points, input.factorGPerKWh),
        degraded: points.length === 0
    };
}

function foldByHourOfDay(
    points: readonly HourlyCarbonPoint[],
    fallbackGPerKWh: number
): number[] {
    const sums = new Array(HOURS_PER_DAY).fill(0);
    const counts = new Array(HOURS_PER_DAY).fill(0);
    for (const point of points) {
        const hour = new Date(point.hour).getUTCHours();
        if (hour >= 0 && hour < HOURS_PER_DAY) {
            sums[hour] += point.gPerKWh;
            counts[hour] += 1;
        }
    }
    return sums.map((sum, hour) =>
        counts[hour] > 0 ? sum / counts[hour] : fallbackGPerKWh
    );
}
