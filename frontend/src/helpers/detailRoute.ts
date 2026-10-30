/** Route IDs are positive database integers; parseInt would accept `12junk`. */
export function parsePositiveRouteId(value: unknown): number | null {
    const raw = Array.isArray(value)
        ? value.length === 1
            ? value[0]
            : null
        : value;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
}

/** Alert instances open in the inbox using query state, not a detail route. */
export function alertInstanceRoute(alertId: number) {
    return {path: '/alerts', query: {instance: String(alertId)}};
}
