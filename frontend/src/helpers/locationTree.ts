import type {Location as ApiLocation} from '@api/location';

// Nested tree node with pre-sorted children for stable render order.
export interface LocationTreeNode {
    location: ApiLocation;
    depth: number;
    children: LocationTreeNode[];
}

// All descendants of `rootId` (ids only). Used for reparent cycle guards
// and for the parent-picker's forbidden set.
export function collectDescendants(
    rootId: number,
    locations: Record<number, ApiLocation>
): Set<number> {
    const out = new Set<number>();
    const childrenByParent = new Map<number, number[]>();
    for (const loc of Object.values(locations)) {
        const p = loc.parentLocationId;
        if (p == null) continue;
        const arr = childrenByParent.get(p);
        if (arr) arr.push(loc.id);
        else childrenByParent.set(p, [loc.id]);
    }
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop() as number;
        const kids = childrenByParent.get(id);
        if (!kids) continue;
        for (const k of kids) {
            if (!out.has(k)) {
                out.add(k);
                stack.push(k);
            }
        }
    }
    return out;
}

// True when `draggedId` can become a child of `targetParentId` without
// creating a cycle. Null target = root (always allowed unless no-op).
export function canReparent(
    draggedId: number,
    targetParentId: number | null,
    locations: Record<number, ApiLocation>
): boolean {
    if (draggedId === targetParentId) return false;
    const dragged = locations[draggedId];
    if (!dragged) return false;
    if ((dragged.parentLocationId ?? null) === targetParentId) return false;
    if (targetParentId == null) return true;
    const descendants = collectDescendants(draggedId, locations);
    return !descendants.has(targetParentId);
}

// Nested tree rooted at locations with parentLocationId == null.
// Children sorted by sortOrder then name for stable display.
export function buildTree(
    locations: Record<number, ApiLocation>
): LocationTreeNode[] {
    const byParent = new Map<number | null, ApiLocation[]>();
    for (const loc of Object.values(locations)) {
        const key = loc.parentLocationId ?? null;
        const bucket = byParent.get(key);
        if (bucket) bucket.push(loc);
        else byParent.set(key, [loc]);
    }
    for (const bucket of byParent.values()) {
        bucket.sort((a, b) => {
            const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
            if (so !== 0) return so;
            return a.name.localeCompare(b.name);
        });
    }

    function node(loc: ApiLocation, depth: number): LocationTreeNode {
        return {
            location: loc,
            depth,
            children: (byParent.get(loc.id) ?? []).map((c) =>
                node(c, depth + 1)
            )
        };
    }

    return (byParent.get(null) ?? []).map((l) => node(l, 0));
}
