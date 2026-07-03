export type DashboardId = number | string;

// Order-preserving dedupe: re-viewing moves an id to the head.
export function pushRecent(
    previous: readonly DashboardId[],
    id: DashboardId,
    limit = 8
): readonly DashboardId[] {
    if (limit <= 0) return [];
    const head = String(id);
    const rest = previous.filter((existing) => String(existing) !== head);
    const next: DashboardId[] = [id, ...rest];
    return next.slice(0, limit);
}

export function removeRecent(
    previous: readonly DashboardId[],
    id: DashboardId
): readonly DashboardId[] {
    const target = String(id);
    return previous.filter((existing) => String(existing) !== target);
}
