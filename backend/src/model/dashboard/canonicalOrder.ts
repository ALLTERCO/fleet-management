// Server-authoritative dashboard ordering: ignore unknown ids the caller
// can't see, and append any visible ids the caller omitted so newly-created
// dashboards stay reachable instead of vanishing.

export function resolveCanonicalOrder(
    visibleIds: Iterable<number>,
    callerIds: ReadonlyArray<number>
): number[] {
    const visible = new Set<number>(visibleIds);
    const seen = new Set<number>();
    const ordered: number[] = [];
    for (const id of callerIds) {
        if (visible.has(id) && !seen.has(id)) {
            ordered.push(id);
            seen.add(id);
        }
    }
    for (const id of visible) {
        if (!seen.has(id)) ordered.push(id);
    }
    return ordered;
}
