// The one place a DevicePlacement is built. Drag-drop, click-to-centre and
// SVG import all go through buildPlacement, so moving a pin can never drop a
// field the user set somewhere else (a spread-based rebuild erased saved
// `fixture` values once — this function exists so that cannot happen twice).

import type {DevicePlacement} from '@/types/floor-plan';

export interface PlacementPoint {
    readonly x: number;
    readonly y: number;
}

// NaN has no position on the plan, so it falls back to the origin. Infinities
// do — they are simply off the edge, and clamp like any other out-of-range
// number. Neither may reach the wire: the placement schema types x/y as
// `number`, and JSON turns both into null.
export function clampToPlan(v: number): number {
    if (Number.isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

/** Move a device to `point`, carrying every other field of `existing`
 *  through untouched.
 *
 *  Fields are copied one by one rather than spread: the backend placement
 *  schema is `additionalProperties: false`, so an unknown key riding along
 *  (the `auto` marker the auto-placer adds, say) would make location.Update
 *  reject the whole save. Adding a field to DevicePlacement means adding it
 *  here too. */
export function buildPlacement(input: {
    readonly existing?: DevicePlacement;
    readonly point: PlacementPoint;
}): DevicePlacement {
    const {existing, point} = input;
    const next: DevicePlacement = {
        x: clampToPlan(point.x),
        y: clampToPlan(point.y),
        rot: existing?.rot ?? 0
    };
    if (existing?.fixture !== undefined) next.fixture = existing.fixture;
    return next;
}
