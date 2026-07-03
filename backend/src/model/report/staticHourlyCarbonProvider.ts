// Flat-curve provider. Used when no real-time API key is configured.
// Returns the org's LBM g/kWh repeated for every hour in the window.

import {HOUR_MS} from '../../modules/util/timeUnits';
import type {
    HourlyCarbonPoint,
    HourlyCarbonProvider,
    HourlyCarbonQuery
} from './hourlyCarbonProvider';

export function buildStaticHourlyCarbonProvider(
    factorGPerKWh: number
): HourlyCarbonProvider {
    return {
        source: 'static-lbm',
        async fetchHourly(query) {
            return synthesizeFlatCurve(query, factorGPerKWh);
        }
    };
}

function synthesizeFlatCurve(
    query: HourlyCarbonQuery,
    factorGPerKWh: number
): HourlyCarbonPoint[] {
    const startMs = Date.parse(query.start);
    const endMs = Date.parse(query.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    if (endMs <= startMs) return [];
    const points: HourlyCarbonPoint[] = [];
    for (let t = startMs; t < endMs; t += HOUR_MS) {
        points.push({hour: new Date(t).toISOString(), gPerKWh: factorGPerKWh});
    }
    return points;
}
