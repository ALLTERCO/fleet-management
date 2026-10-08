import type {
    ParkingDistanceRatioSource,
    ParkingDistanceThresholdSource,
    ParkingOccupancySource,
    ParkingOccupancyStatus,
    ParkingOperationalPolicy,
    ParkingOperationalVerdict,
    ParkingSafetyKindVerdict,
    ParkingSafetySource,
    ParkingSafetySourceVerdict,
    ParkingSpotVerdict
} from '../../types/api/operations';

export interface ParkingSourceSnapshot {
    source: {
        customDeviceId: string;
        roleKey: string;
    };
    value: unknown;
    reportedAt: number | null;
}

export function parkingOccupancyVerdict(
    policy: ParkingOperationalPolicy | undefined,
    snapshots: readonly ParkingSourceSnapshot[],
    now: number
): ParkingOperationalVerdict {
    if (!policy) return unavailablePolicyVerdict();

    const snapshotsBySource = new Map(
        snapshots.map((snapshot) => [sourceKey(snapshot.source), snapshot])
    );
    const spots = policy.sources.map((source) =>
        spotVerdict(
            source,
            snapshotsBySource.get(sourceKey(source)),
            policy.freshnessSec,
            now
        )
    );
    const occupied = spots.filter((spot) => spot.occupied === true).length;
    const available = spots.filter((spot) => spot.occupied === false).length;
    const unavailable = spots.filter((spot) => spot.occupied === null).length;

    return {
        policyId: policy.id,
        status: aggregateStatus(spots),
        coverage: coverageOf(
            spots,
            policy.freshnessSec,
            snapshotsBySource,
            now
        ),
        occupied,
        available,
        unavailable,
        occupancyPercent:
            unavailable === 0 && spots.length > 0
                ? Math.round((occupied / spots.length) * 100)
                : null,
        spots,
        safety: safetyVerdict(
            policy.safetySources ?? [],
            snapshotsBySource,
            policy.freshnessSec,
            now
        )
    };
}

function unavailablePolicyVerdict(): ParkingOperationalVerdict {
    return {
        policyId: '',
        status: 'config_missing',
        coverage: {
            configuredSources: 0,
            observedSources: 0,
            freshSources: 0
        },
        occupied: 0,
        available: 0,
        unavailable: 0,
        occupancyPercent: null,
        spots: [],
        safety: {
            smoke: missingSafetyConfiguration(),
            flood: missingSafetyConfiguration(),
            gas: missingSafetyConfiguration()
        }
    };
}

function safetyVerdict(
    sources: readonly ParkingSafetySource[],
    snapshotsBySource: ReadonlyMap<string, ParkingSourceSnapshot>,
    freshnessSec: number,
    now: number
): ParkingOperationalVerdict['safety'] {
    return {
        smoke: safetyKindVerdict(
            sources.filter((source) => source.kind === 'smoke'),
            snapshotsBySource,
            freshnessSec,
            now
        ),
        flood: safetyKindVerdict(
            sources.filter((source) => source.kind === 'flood'),
            snapshotsBySource,
            freshnessSec,
            now
        ),
        gas: safetyKindVerdict(
            sources.filter((source) => source.kind === 'gas'),
            snapshotsBySource,
            freshnessSec,
            now
        )
    };
}

function safetyKindVerdict(
    sources: readonly ParkingSafetySource[],
    snapshotsBySource: ReadonlyMap<string, ParkingSourceSnapshot>,
    freshnessSec: number,
    now: number
): ParkingSafetyKindVerdict {
    if (sources.length === 0) return missingSafetyConfiguration();

    const sourceVerdicts = sources.map((source) =>
        safetySourceVerdict(
            source,
            snapshotsBySource.get(sourceKey(source)),
            freshnessSec,
            now
        )
    );
    const freshAlarm = sourceVerdicts.some(
        (source) => source.status === 'alarm'
    );
    const allFresh = sourceVerdicts.every(
        (source) => source.status === 'clear' || source.status === 'alarm'
    );

    return {
        status: freshAlarm
            ? 'alarm'
            : sourceVerdicts.some((source) => source.status === 'data_missing')
              ? 'data_missing'
              : sourceVerdicts.some((source) => source.status === 'stale')
                ? 'stale'
                : 'clear',
        coverage: safetyCoverage(sources, snapshotsBySource, freshnessSec, now),
        alarm: freshAlarm ? true : allFresh ? false : null,
        sources: sourceVerdicts
    };
}

function missingSafetyConfiguration(): ParkingSafetyKindVerdict {
    return {
        status: 'config_missing',
        coverage: {
            configuredSources: 0,
            observedSources: 0,
            freshSources: 0
        },
        alarm: null,
        sources: []
    };
}

function safetySourceVerdict(
    source: ParkingSafetySource,
    snapshot: ParkingSourceSnapshot | undefined,
    freshnessSec: number,
    now: number
): ParkingSafetySourceVerdict {
    const identity = {
        id: source.id,
        customDeviceId: source.customDeviceId,
        roleKey: source.roleKey
    };
    if (!snapshot || !isTimestamp(snapshot.reportedAt)) {
        return {
            ...identity,
            status: 'data_missing',
            alarm: null,
            observedAt: null
        };
    }

    const observedAt = new Date(snapshot.reportedAt).toISOString();
    const alarm = classifySafetyAlarm(source, snapshot.value);
    if (alarm === null) {
        return {
            ...identity,
            status: 'data_missing',
            alarm: null,
            observedAt
        };
    }

    if (!isFresh(snapshot.reportedAt, freshnessSec, now)) {
        return {...identity, status: 'stale', alarm, observedAt};
    }
    return {
        ...identity,
        status: alarm ? 'alarm' : 'clear',
        alarm,
        observedAt
    };
}

function classifySafetyAlarm(
    source: ParkingSafetySource,
    value: unknown
): boolean | null {
    if (source.kind !== 'gas') {
        return typeof value === 'boolean' ? value === source.alarmWhen : null;
    }
    if (value === 'none') return false;
    if (value === 'mild' || value === 'heavy') return true;
    return null;
}

function safetyCoverage(
    sources: readonly ParkingSafetySource[],
    snapshotsBySource: ReadonlyMap<string, ParkingSourceSnapshot>,
    freshnessSec: number,
    now: number
): ParkingSafetyKindVerdict['coverage'] {
    const observed = sources.flatMap((source) => {
        const snapshot = snapshotsBySource.get(sourceKey(source));
        return snapshot && isTimestamp(snapshot.reportedAt) ? [snapshot] : [];
    });
    return {
        configuredSources: sources.length,
        observedSources: observed.length,
        freshSources: observed.filter((snapshot) =>
            isFresh(snapshot.reportedAt!, freshnessSec, now)
        ).length
    };
}

function spotVerdict(
    source: ParkingOccupancySource,
    snapshot: ParkingSourceSnapshot | undefined,
    freshnessSec: number,
    now: number
): ParkingSpotVerdict {
    const identity = {
        id: source.id,
        customDeviceId: source.customDeviceId,
        roleKey: source.roleKey
    };
    if (!snapshot || !isTimestamp(snapshot.reportedAt)) {
        return {
            ...identity,
            status: 'data_missing',
            occupied: null,
            observedAt: null
        };
    }

    const occupied = classifyReading(source, snapshot.value);
    const observedAt = new Date(snapshot.reportedAt).toISOString();
    if (occupied === null) {
        return {
            ...identity,
            status: 'data_missing',
            occupied: null,
            observedAt
        };
    }
    if (!isFresh(snapshot.reportedAt, freshnessSec, now)) {
        return {...identity, status: 'stale', occupied, observedAt};
    }
    return {
        ...identity,
        status: occupied ? 'occupied' : 'available',
        occupied,
        observedAt
    };
}

function classifyReading(
    source: ParkingOccupancySource,
    value: unknown
): boolean | null {
    if (source.kind === 'boolean') {
        return typeof value === 'boolean'
            ? value === source.occupiedWhen
            : null;
    }
    if (!isNonNegativeFiniteNumber(value)) return null;

    const occupiedBelowM = occupiedThresholdM(source);
    if (occupiedBelowM === null) return null;
    return isStrictlyBelow(value, occupiedBelowM);
}

function occupiedThresholdM(
    source: ParkingDistanceRatioSource | ParkingDistanceThresholdSource
): number | null {
    if (source.calibration.mode === 'threshold') {
        return isPositiveFiniteNumber(source.calibration.occupiedBelowM)
            ? source.calibration.occupiedBelowM
            : null;
    }
    if (
        !isPositiveFiniteNumber(source.calibration.mountHeightM) ||
        !isPositiveFiniteNumber(source.calibration.occupiedRatio) ||
        source.calibration.occupiedRatio > 1
    ) {
        return null;
    }
    return source.calibration.mountHeightM * source.calibration.occupiedRatio;
}

function aggregateStatus(
    spots: readonly ParkingSpotVerdict[]
): ParkingOccupancyStatus {
    if (spots.length === 0) return 'data_missing';
    if (spots.some((spot) => spot.status === 'data_missing'))
        return 'data_missing';
    if (spots.some((spot) => spot.status === 'stale')) return 'stale';
    return 'operational';
}

function coverageOf(
    spots: readonly ParkingSpotVerdict[],
    freshnessSec: number,
    snapshotsBySource: ReadonlyMap<string, ParkingSourceSnapshot>,
    now: number
): ParkingOperationalVerdict['coverage'] {
    const observed = spots.flatMap((spot) => {
        const snapshot = snapshotsBySource.get(sourceKey(spot));
        return snapshot && isTimestamp(snapshot.reportedAt) ? [snapshot] : [];
    });
    return {
        configuredSources: spots.length,
        observedSources: observed.length,
        freshSources: observed.filter((snapshot) =>
            isFresh(snapshot.reportedAt!, freshnessSec, now)
        ).length
    };
}

function sourceKey(source: {customDeviceId: string; roleKey: string}): string {
    return `${source.customDeviceId}\u0000${source.roleKey}`;
}

function isTimestamp(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFresh(
    reportedAt: number,
    freshnessSec: number,
    now: number
): boolean {
    return now - reportedAt <= freshnessSec * 1000;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isStrictlyBelow(value: number, threshold: number): boolean {
    const tolerance =
        Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(threshold)) * 8;
    return threshold - value > tolerance;
}
