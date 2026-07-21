// Deterministic fixture for the environment dashboard — used by unit tests
// and for local presenter preview. No randomness, so assertions stay stable.

import {
    DEFAULT_ENV_SETTINGS,
    type EnvHistoryRow,
    type EnvironmentDashboardInput
} from './environmentDashboard.types';

const BASE_MS = Date.parse('2026-07-06T00:00:00Z');

function iso(hourOffset: number): string {
    return new Date(BASE_MS + hourOffset * 3_600_000).toISOString();
}

/** One kind, two devices, `hours` hourly buckets around `center` ± `swing`. */
function series(
    kind: string,
    center: number,
    swing: number,
    hours = 24
): EnvHistoryRow[] {
    const rows: EnvHistoryRow[] = [];
    for (let h = 0; h < hours; h++) {
        // Deterministic diurnal wobble via a sine, no Math.random.
        const wobble = swing * Math.sin((h / hours) * Math.PI * 2);
        for (const deviceId of [1, 2]) {
            const value = center + wobble + (deviceId === 2 ? swing * 0.2 : 0);
            rows.push({
                bucket: iso(h),
                deviceId,
                kind,
                value: Math.round(value * 100) / 100,
                min: Math.round((value - 0.5) * 100) / 100,
                max: Math.round((value + 0.5) * 100) / 100,
                source: deviceId === 2 ? 'blu' : 'internal',
                channel: 0,
                sampleCount: 4
            });
        }
    }
    return rows;
}

export function sampleEnvironmentInput(): EnvironmentDashboardInput {
    const history: EnvHistoryRow[] = [
        ...series('temperature', 22, 2),
        ...series('humidity', 45, 8),
        ...series('illuminance', 400, 380),
        ...series('co2', 700, 150),
        ...series('pm25', 8, 3),
        ...series('pressure', 1013, 4),
        ...series('wind_speed', 3, 2)
    ];
    return {
        meta: {
            scopeName: 'All sensors',
            from: iso(0),
            to: iso(24),
            granularity: '1 hour',
            generatedAt: BASE_MS
        },
        live: {
            temperature: [
                {deviceId: 1, value: 22.4},
                {deviceId: 2, value: 23.1}
            ],
            humidity: [
                {deviceId: 1, value: 46},
                {deviceId: 2, value: 48}
            ],
            luminance: [
                {deviceId: 1, value: 320},
                {deviceId: 2, value: 280}
            ]
        },
        history,
        events: [],
        sensors: [
            {
                id: 1,
                shellyId: 'shelly-ht-001',
                name: 'Office H&T',
                online: true,
                source: 'internal',
                battery: 92
            },
            {
                id: 2,
                shellyId: 'shelly-blu-002',
                name: 'Warehouse BLU',
                online: true,
                source: 'blu',
                battery: 61
            }
        ],
        settings: DEFAULT_ENV_SETTINGS
    };
}
