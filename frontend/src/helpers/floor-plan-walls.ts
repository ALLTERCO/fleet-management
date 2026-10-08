// The wall model. One representation, two sources.
//
// D-032: hand-drawing a wall is a normal way to set up a floor, not a
// fallback for a failed import. So an SVG-extracted wall and a drawn wall
// must be the same kind of thing by the time anything renders them —
// otherwise the extruder grows a branch per source and they drift.
//
// Canonical form is WallSegment: endpoints normalized 0..1 against the
// plan, identical in space to ZoneShape.points and DevicePlacement.

import {clampToPlan} from '@/helpers/floor-plan-placement';
import type {SvgFloorPlanGeometry} from '@/helpers/svg-walls';
import type {PlanPoint, WallSegment} from '@/types/floor-plan';

/** Shortest wall worth keeping, as a fraction of the plan.
 *
 *  One number, shared with the 3D extruder's world-space cull, so "short
 *  enough to save" and "long enough to draw" can never disagree — a wall
 *  the user saved but cannot see would be unfindable and undeletable.
 *  Resolution-independent, so re-uploading the plan larger does not change
 *  which walls survive. */
export const MIN_WALL_LENGTH = 5e-3;

/** SVG-extracted geometry → the canonical model.
 *
 *  Divides by the extractor's own wall bounding box, which is exactly the
 *  rect the 3D scene already stretched those walls into. The numbers
 *  change; the picture does not. */
export function normalizeSvgWalls(
    geom: SvgFloorPlanGeometry | null
): WallSegment[] {
    if (!geom || geom.width <= 0 || geom.height <= 0) return [];
    return sanitizeWalls(
        geom.walls.map((w) => ({
            from: {x: w.from[0] / geom.width, y: w.from[1] / geom.height},
            to: {x: w.to[0] / geom.width, y: w.to[1] / geom.height}
        }))
    );
}

/** Clamp onto the plan and drop degenerate runs. Every path that produces
 *  walls ends here, so nothing off-plan or zero-length reaches the wire —
 *  the backend schema bounds x/y to 0..1 and would reject the whole save. */
export function sanitizeWalls(segments: readonly WallSegment[]): WallSegment[] {
    const out: WallSegment[] = [];
    for (const seg of segments) {
        const wall: WallSegment = {
            from: clampPoint(seg.from),
            to: clampPoint(seg.to)
        };
        if (wallLength(wall) < MIN_WALL_LENGTH) continue;
        out.push(wall);
    }
    return out;
}

export function wallLength(wall: WallSegment): number {
    return Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y);
}

/** Append newly drawn runs to what the floor already has. Sanitizing the
 *  join (not just the new part) means a wall list that arrived malformed
 *  is repaired on the next edit instead of failing every future save. */
export function appendWalls(
    existing: readonly WallSegment[],
    added: readonly WallSegment[]
): WallSegment[] {
    return sanitizeWalls([...existing, ...added]);
}

/** Drop the most recently added wall. Backs the single Undo the drawing
 *  tools expose: with the draft empty, undo steps back through committed
 *  segments instead of doing nothing. */
export function undoLastWall(walls: readonly WallSegment[]): WallSegment[] {
    if (walls.length === 0) return [...walls];
    return walls.slice(0, -1);
}

function clampPoint(p: PlanPoint): PlanPoint {
    return {x: clampToPlan(p.x), y: clampToPlan(p.y)};
}
