/**
 * The authoritative collection level comes from the backend health snapshot.
 * Browser-local observability is separate and may have another level.
 */
export function formatBackendObservabilityLevel(
    backendLevel: unknown,
    labels: readonly string[]
): string {
    const level = parseBackendObservabilityLevel(backendLevel, labels.length);
    return level === null ? 'not available' : labels[level];
}

export function parseBackendObservabilityLevel(
    backendLevel: unknown,
    levels = 4
): number | null {
    return typeof backendLevel === 'number' &&
        Number.isInteger(backendLevel) &&
        backendLevel >= 0 &&
        backendLevel < levels
        ? backendLevel
        : null;
}

/** A browser-local telemetry change must never implicitly send this RPC. */
export async function sendAuthorizedBackendObservabilityLevel(
    level: number,
    canCall: () => boolean,
    send: (level: number) => Promise<unknown>
): Promise<boolean> {
    if (!canCall()) return false;
    await send(level);
    return true;
}
