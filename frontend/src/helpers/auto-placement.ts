// Auto-placement for devices that have no saved (x, y) on the floor plan.
// Returns a grid of normalized coords (0..1) centered on the plan, sorted by
// id so the layout is stable across renders. Manual placements always win
// downstream — this only fills the gap so unplaced devices are visible.

import type {DevicePlacement} from '@/types/floor-plan';

// Use 60% of the plan; leaves headroom for placed devices + readability.
const GRID_MARGIN = 0.2;
const GRID_USABLE = 1 - GRID_MARGIN * 2;

export interface AutoPlacement extends DevicePlacement {
    auto: true;
}

export function computeAutoPlacements(
    deviceIds: readonly string[]
): Record<string, AutoPlacement> {
    if (deviceIds.length === 0) return {};
    const ids = [...deviceIds].sort();
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / cols);
    const out: Record<string, AutoPlacement> = {};
    for (let i = 0; i < ids.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        out[ids[i]] = {
            x: GRID_MARGIN + ((col + 0.5) / cols) * GRID_USABLE,
            y: GRID_MARGIN + ((row + 0.5) / rows) * GRID_USABLE,
            auto: true
        };
    }
    return out;
}

// Merge manual placements over the auto layer. Manual wins on every field
// (including rot/fixture) so a saved placement isn't surprised by stale
// defaults from the auto map.
export function mergePlacements(
    auto: Record<string, AutoPlacement>,
    manual: Record<string, DevicePlacement>
): Record<string, DevicePlacement> {
    return {...auto, ...manual};
}

// Runtime check used by both 2D and 3D renderers to style ghost pins
// (auto-placed) differently from solid ones (user-placed). Reads the
// marker the auto-placer wrote — the canonical DevicePlacement type
// stays clean of presentation concerns.
export function isAutoPlaced(p: DevicePlacement): boolean {
    return (p as {auto?: boolean}).auto === true;
}
