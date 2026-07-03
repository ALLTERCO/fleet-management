// Persistent dashboard ordering — single home for read/persist + key.

export type OrderedId = number | string;

export const DASHBOARD_ORDER_KEY = 'fm-dashboard-order';
export const DEFAULT_DASHBOARD_ID = 1;

// Strict integer parse — '0x1', '1.0', ' 1 ' all fail. Returns null for
// anything we can't safely send to the backend.
export function toFiniteDashId(id: number | string): number | null {
    if (typeof id === 'number') {
        return Number.isFinite(id) && Number.isInteger(id) ? id : null;
    }
    if (typeof id === 'string' && /^-?\d+$/.test(id)) {
        const n = Number(id);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

export function isDefaultDashboard(id: number | string): boolean {
    return toFiniteDashId(id) === DEFAULT_DASHBOARD_ID;
}

export function readDashboardOrder(): readonly OrderedId[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(DASHBOARD_ORDER_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function persistDashboardOrder(ids: readonly OrderedId[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(ids));
    } catch {
        // Quota / private mode — drop.
    }
}

// Swap two adjacent positions in `ids`. Pure — returns a new array.
export function reorderById(
    ids: readonly OrderedId[],
    id: OrderedId,
    direction: -1 | 1
): readonly OrderedId[] {
    const index = ids.findIndex((existing) => String(existing) === String(id));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return ids;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

// Remove ids from the order list (post-delete cleanup).
export function purgeOrderedIds(
    ids: readonly OrderedId[],
    drop: readonly OrderedId[]
): readonly OrderedId[] {
    const blocked = new Set(drop.map(String));
    return ids.filter((existing) => !blocked.has(String(existing)));
}
