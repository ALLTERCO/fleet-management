export interface RedisRuntimeSnapshot {
    version: string;
    evictionPolicy: string;
    aofEnabled: boolean | null;
    lastSuccessfulAtSeconds: number;
}

const unknownSnapshot: RedisRuntimeSnapshot = {
    version: 'unknown',
    evictionPolicy: 'unknown',
    aofEnabled: null,
    lastSuccessfulAtSeconds: -1
};

let snapshot = unknownSnapshot;

export function setRedisRuntimeSnapshot(
    next: Omit<RedisRuntimeSnapshot, 'lastSuccessfulAtSeconds'>,
    nowMs = Date.now()
): void {
    snapshot = {
        ...next,
        lastSuccessfulAtSeconds: Math.floor(nowMs / 1000)
    };
}

export function getRedisRuntimeSnapshot(): RedisRuntimeSnapshot {
    return snapshot;
}

export function resetRedisRuntimeSnapshotForTests(): void {
    snapshot = unknownSnapshot;
}
