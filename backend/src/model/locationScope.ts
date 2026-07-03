export type LocationParentMap = ReadonlyMap<number, number | null>;

const MAX_LOCATION_DEPTH = 64;

export function isLocationInScope(
    locationId: number,
    selected: readonly number[],
    locationParents: LocationParentMap
): boolean {
    const selectedIds = new Set(selected);
    if (selectedIds.has(locationId)) return true;

    const seen = new Set<number>([locationId]);
    let parent = locationParents.get(locationId) ?? null;
    let depth = 0;
    while (parent != null && depth < MAX_LOCATION_DEPTH) {
        if (selectedIds.has(parent)) return true;
        if (seen.has(parent)) return false;
        seen.add(parent);
        parent = locationParents.get(parent) ?? null;
        depth++;
    }

    return false;
}

export function expandLocationScope(
    selected: readonly number[],
    locationParents: LocationParentMap
): number[] {
    const candidates = new Set([...selected, ...locationParents.keys()]);
    return Array.from(candidates).filter((id) =>
        isLocationInScope(id, selected, locationParents)
    );
}
