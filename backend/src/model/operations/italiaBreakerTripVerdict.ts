import type {ItaliaBreakerTripPolicy} from '../../types/api/operations';

export interface ItaliaBreakerCounterReading {
    readonly observedAt: string;
    readonly totalCycles: number | null;
}

export type ItaliaBreakerTripStatus =
    | 'config_missing'
    | 'no_readings'
    | 'one_reading'
    | 'counter_reset'
    | 'complete';

export interface ItaliaBreakerTripVerdict {
    readonly pitchId: number;
    readonly logicalDeviceId: number | null;
    readonly status: ItaliaBreakerTripStatus;
    readonly trips: number | null;
    readonly readingsUsed: number;
    readonly from: string | null;
    readonly to: string | null;
}

export function evaluateItaliaBreakerTrips(
    policy: ItaliaBreakerTripPolicy | undefined,
    readings: readonly ItaliaBreakerCounterReading[],
    period: {readonly from: Date; readonly to: Date} | undefined
): ItaliaBreakerTripVerdict {
    if (!policy || !period) {
        return {
            pitchId: policy?.pitchId ?? 0,
            logicalDeviceId: policy?.logicalDeviceId ?? null,
            status: 'config_missing',
            trips: null,
            readingsUsed: 0,
            from: null,
            to: null
        };
    }
    const usable = readings
        .map((reading, index) => ({
            reading,
            index,
            observedMs: Date.parse(reading.observedAt)
        }))
        .filter(
            ({reading, observedMs}) =>
                Number.isFinite(observedMs) &&
                reading.totalCycles !== null &&
                Number.isInteger(reading.totalCycles) &&
                reading.totalCycles >= 0
        )
        .sort(
            (left, right) =>
                left.observedMs - right.observedMs || left.index - right.index
        )
        .map(({reading}) => reading.totalCycles as number);
    const base = {
        pitchId: policy.pitchId,
        logicalDeviceId: policy.logicalDeviceId,
        readingsUsed: usable.length,
        from: period.from.toISOString(),
        to: period.to.toISOString()
    };
    if (usable.length === 0)
        return {...base, status: 'no_readings', trips: null};
    if (usable.length === 1)
        return {...base, status: 'one_reading', trips: null};
    let trips = 0;
    for (let index = 1; index < usable.length; index += 1) {
        const difference = usable[index] - usable[index - 1];
        if (difference < 0)
            return {...base, status: 'counter_reset', trips: null};
        trips += difference;
    }
    return {...base, status: 'complete', trips};
}
