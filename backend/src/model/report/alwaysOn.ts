// Phantom-load floor: smallest per-bucket avg watts, treated as continuous draw.

export interface PowerSample {
    readonly deviceId: number;
    readonly watts: number;
}

export interface AlwaysOnInput {
    readonly samples: readonly PowerSample[];
    readonly periodHours: number;
}

export interface AlwaysOnResult {
    readonly totalKWh: number;
    readonly perDeviceWatts: ReadonlyMap<number, number>;
}

// Sub-watt floors are metering noise — would create false positives.
const MIN_REPORTABLE_WATTS = 1;

export function computeAlwaysOn({
    samples,
    periodHours
}: AlwaysOnInput): AlwaysOnResult {
    const perDeviceWatts = new Map<number, number>();
    if (!Number.isFinite(periodHours) || periodHours <= 0) {
        return {totalKWh: 0, perDeviceWatts};
    }

    const floors = new Map<number, number>();
    for (const s of samples) {
        if (!Number.isFinite(s.watts) || s.watts < 0) continue;
        const cur = floors.get(s.deviceId);
        if (cur === undefined || s.watts < cur) floors.set(s.deviceId, s.watts);
    }

    let totalKWh = 0;
    for (const [id, watts] of floors) {
        if (watts < MIN_REPORTABLE_WATTS) {
            perDeviceWatts.set(id, 0);
            continue;
        }
        perDeviceWatts.set(id, +watts.toFixed(1));
        totalKWh += (watts * periodHours) / 1000;
    }
    return {totalKWh: +totalKWh.toFixed(3), perDeviceWatts};
}
