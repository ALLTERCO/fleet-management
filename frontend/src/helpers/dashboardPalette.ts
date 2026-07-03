import {appearanceForDashboardType} from '@/types/dashboard';

export type DashboardTypeKey = 'classic' | 'analytics' | string;

export interface PaletteRow {
    readonly id: number | string;
    readonly name: string;
    readonly type: DashboardTypeKey;
    readonly widgetCount: number;
    readonly color?: string;
    readonly isPinned: boolean;
    readonly isDefault: boolean;
}

export interface PaletteEmptySection {
    readonly key: 'recents' | 'pinned' | 'all';
    readonly label: string;
    readonly rows: readonly PaletteRow[];
}

export interface PaletteEmptyState {
    readonly sections: readonly PaletteEmptySection[];
}

export interface PaletteSection {
    readonly typeKey: DashboardTypeKey;
    readonly label: string;
    readonly rows: readonly PaletteRow[];
}

export function typeLabel(typeKey: DashboardTypeKey): string {
    if (typeKey.length === 0) return 'Other';
    const registered = appearanceForDashboardType(typeKey);
    // appearanceForDashboardType returns 'Dashboard' for unknown keys; for an
    // unknown type, prefer the capitalised key so new domains render readably.
    if (registered.label !== 'Dashboard') return registered.label;
    return typeKey.charAt(0).toUpperCase() + typeKey.slice(1);
}

// Notion-style quick-find. The section returned tells the truth:
// "Recently viewed", "Pinned", or "All dashboards" when nothing is pinned.
export function paletteEmptyState(
    rows: readonly PaletteRow[],
    recentIds: readonly (number | string)[],
    limit = 5
): PaletteEmptyState {
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const recents = takeRecents(byId, recentIds, limit);
    const excluded = new Set(recents.map((row) => String(row.id)));
    const sections: PaletteEmptySection[] = [];
    if (recents.length > 0) {
        sections.push({
            key: 'recents',
            label: 'Recently viewed',
            rows: recents
        });
    }
    const truePinned = rows
        .filter((row) => row.isPinned && !excluded.has(String(row.id)))
        .slice(0, limit);
    if (truePinned.length > 0) {
        sections.push({key: 'pinned', label: 'Pinned', rows: truePinned});
        return {sections};
    }
    const remaining = rows
        .filter((row) => !excluded.has(String(row.id)))
        .slice(0, limit);
    if (remaining.length > 0) {
        sections.push({key: 'all', label: 'All dashboards', rows: remaining});
    }
    return {sections};
}

function takeRecents(
    byId: ReadonlyMap<string, PaletteRow>,
    recentIds: readonly (number | string)[],
    limit: number
): readonly PaletteRow[] {
    const out: PaletteRow[] = [];
    for (const id of recentIds) {
        const row = byId.get(String(id));
        if (row && out.length < limit) out.push(row);
    }
    return out;
}

export function groupRowsByType(
    rows: readonly PaletteRow[]
): readonly PaletteSection[] {
    const sections = new Map<DashboardTypeKey, PaletteRow[]>();
    for (const row of rows) {
        const bucket = sections.get(row.type) ?? [];
        bucket.push(row);
        sections.set(row.type, bucket);
    }
    return Array.from(sections, ([typeKey, sectionRows]) => ({
        typeKey,
        label: typeLabel(typeKey),
        rows: sectionRows
    }));
}

export function flattenSections(
    sections: readonly PaletteSection[]
): readonly PaletteRow[] {
    return sections.flatMap((section) => section.rows);
}

// Wrap-around highlight nav; null in → enter at first (down) or last (up).
export function nextHighlightIndex(
    length: number,
    current: number | null,
    direction: 'up' | 'down'
): number | null {
    if (length <= 0) return null;
    if (current == null) return direction === 'down' ? 0 : length - 1;
    const step = direction === 'down' ? 1 : -1;
    const raw = current + step;
    return ((raw % length) + length) % length;
}
