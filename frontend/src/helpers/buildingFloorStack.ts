/** Pure layout math for the "exploded floor stack" 3D view.
 *
 *  When the user selects a Building node and opens the Plan tab, the
 *  right pane renders every child floor as a stacked plane. This module
 *  decides where each plane sits (Y position), how big it is, and what
 *  label rides with it. The Three.js component picks up these entries
 *  and renders them — keeping the math here pure makes the layout
 *  testable without WebGL. */

import type {ApiLocation} from '@/stores/locations';

export interface FloorStackOptions {
    /** Vertical gap between floor planes, in world-units. */
    readonly gapY: number;
    /** Edge length of each square floor plane, in world-units. */
    readonly planeSize: number;
}

export interface FloorStackEntry {
    readonly id: number;
    readonly name: string;
    /** Y coordinate of the plane's center. Bottom floor sits at 0. */
    readonly y: number;
    /** Edge length of this plane. Constant per stack today but kept
     *  per-entry so future per-floor sizing doesn't break the contract. */
    readonly size: number;
    /** Floor order index — 0 is the bottom of the stack. */
    readonly order: number;
}

export interface FloorStackLayout {
    readonly entries: readonly FloorStackEntry[];
    /** Total height of the stack, useful for camera framing. */
    readonly totalHeightY: number;
}

const EMPTY_LAYOUT: FloorStackLayout = Object.freeze({
    entries: [],
    totalHeightY: 0
});

/** Layout the floors of a building into a vertical stack.
 *  Input is the building's direct children filtered to kind === 'floor';
 *  output is the stack entries ready to render plus framing info.
 *
 *  Throws `RangeError` if `gapY` or `planeSize` are not positive finite
 *  numbers — those represent physical world units and silently passing a
 *  zero/negative/NaN value would produce overlapping or invisible geometry. */
export function computeFloorStackLayout(input: {
    readonly floors: readonly ApiLocation[];
    readonly options: FloorStackOptions;
}): FloorStackLayout {
    assertPositiveFinite(input.options.gapY, 'options.gapY');
    assertPositiveFinite(input.options.planeSize, 'options.planeSize');

    if (input.floors.length === 0) return EMPTY_LAYOUT;
    const sorted = sortFloorsBottomUp(input.floors);
    const entries = sorted.map((floor, order) =>
        toStackEntry(floor, order, input.options)
    );
    const top = entries[entries.length - 1];
    return {
        entries,
        totalHeightY: top.y + input.options.planeSize / 2
    };
}

function assertPositiveFinite(value: number, fieldName: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(
            `${fieldName} must be a positive finite number, got ${String(value)}`
        );
    }
}

/** Sort floors so the bottom of the stack comes first (lowest sortOrder
 *  is the ground floor). Name ties break lexicographically so the order
 *  stays deterministic for screenshots and tests. */
function sortFloorsBottomUp(
    floors: readonly ApiLocation[]
): readonly ApiLocation[] {
    return [...floors].sort(compareFloorsBottomUp);
}

function compareFloorsBottomUp(a: ApiLocation, b: ApiLocation): number {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
}

function toStackEntry(
    floor: ApiLocation,
    order: number,
    options: FloorStackOptions
): FloorStackEntry {
    return {
        id: floor.id,
        name: floor.name,
        y: order * options.gapY,
        size: options.planeSize,
        order
    };
}

/** Direct floor children of a building. Reaches into the locations
 *  record once so callers don't reproduce the filter at every render. */
export function selectFloorsOfBuilding(input: {
    readonly buildingId: number;
    readonly locations: Readonly<Record<number, ApiLocation>>;
}): readonly ApiLocation[] {
    const out: ApiLocation[] = [];
    for (const loc of Object.values(input.locations)) {
        if (loc.parentLocationId !== input.buildingId) continue;
        if (loc.kind !== 'floor') continue;
        out.push(loc);
    }
    return out;
}
