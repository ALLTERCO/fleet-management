// Redis-backed features that wait for Redis to accept a command they need,
// for example a consumer group or a subscription while Redis is at maxmemory.
// The process still serves; health reports these as degraded.

const waiting = new Set<string>();

export function markRedisWaiting(feature: string, isWaiting: boolean): void {
    if (isWaiting) waiting.add(feature);
    else waiting.delete(feature);
}

export function redisFeaturesWaiting(): string[] {
    return [...waiting].sort();
}
