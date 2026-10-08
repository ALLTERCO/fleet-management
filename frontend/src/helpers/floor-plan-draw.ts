// The one draw-state machine for the floor plan.
//
// Both canvases (2D Pixi, 3D three.js) feed it the same normalized vertex,
// and both tools (zone polygon, wall run) share its add / undo / commit
// rules. So "undo" means one thing everywhere, and a drawing bug has one
// place to be fixed.
//
// Pure by design: no Vue, no Pixi, no three.js. The renderers decide how a
// draft looks; this decides what a draft IS.

import {clampToPlan} from '@/helpers/floor-plan-placement';
import type {PlanPoint, WallSegment, ZoneShape} from '@/types/floor-plan';

export type DrawTool = 'zone' | 'wall';

export interface DrawDraft {
    readonly tool: DrawTool;
    readonly points: readonly PlanPoint[];
}

// A zone is a closed polygon, a wall run is an open chain. That minimum is
// the only geometric rule that differs between the two tools.
const MIN_VERTICES: Record<DrawTool, number> = {zone: 3, wall: 2};

// Two clicks closer than this on a 0..1 plan are one click. Without it a
// double-tap places a zero-length segment that renders as nothing and is
// impossible to select or delete afterwards.
const MIN_VERTEX_GAP = 1e-4;

export function beginDraft(tool: DrawTool): DrawDraft {
    return {tool, points: []};
}

/** Append a vertex. Coordinates are clamped, so a drag that leaves the
 *  plan lands on its edge rather than persisting an off-plan point the
 *  backend schema would reject. */
export function addVertex(draft: DrawDraft, point: PlanPoint): DrawDraft {
    const next: PlanPoint = {x: clampToPlan(point.x), y: clampToPlan(point.y)};
    const last = draft.points.at(-1);
    // Only consecutive repeats are dropped: a wall run may legitimately
    // pass back through a corner it already visited.
    if (last && isSamePoint(last, next)) return draft;
    return {tool: draft.tool, points: [...draft.points, next]};
}

/** Remove the most recent vertex. An empty draft stays empty — undo is
 *  never the thing that ends a draft; Cancel is. */
export function undoVertex(draft: DrawDraft): DrawDraft {
    if (draft.points.length === 0) return draft;
    return {tool: draft.tool, points: draft.points.slice(0, -1)};
}

export function canUndo(draft: DrawDraft | null): boolean {
    return (draft?.points.length ?? 0) > 0;
}

/** Whether the draft has the geometry its tool needs. Names and colours
 *  are the UI's business; this answers the geometric half only. */
export function hasEnoughVertices(draft: DrawDraft | null): boolean {
    if (!draft) return false;
    return draft.points.length >= MIN_VERTICES[draft.tool];
}

/** The segments a draft currently describes — an open chain for a wall
 *  run, and for a zone the same chain plus the edge that closes it.
 *
 *  Doubles as the live preview both canvases draw, so what the user sees
 *  mid-draw is exactly what a commit would produce. */
export function draftSegments(draft: DrawDraft | null): WallSegment[] {
    if (!draft || draft.points.length < 2) return [];
    const closed = draft.tool === 'zone' && draft.points.length >= 3;
    return chainSegments(draft.points, {closed});
}

/** Commit a wall draft. Returns [] for a draft too short to be a wall, so
 *  a caller that skips hasEnoughVertices still cannot persist junk. */
export function draftToWallSegments(draft: DrawDraft): WallSegment[] {
    if (draft.tool !== 'wall' || !hasEnoughVertices(draft)) return [];
    return chainSegments(draft.points, {closed: false});
}

export interface ZoneIdentity {
    readonly id: string;
    readonly name: string;
    readonly color: string;
}

/** Commit a zone draft. Returns null rather than a half-formed zone when
 *  the draft or the name is not ready. */
export function draftToZone(
    draft: DrawDraft,
    identity: ZoneIdentity
): ZoneShape | null {
    if (draft.tool !== 'zone' || !hasEnoughVertices(draft)) return null;
    if (identity.name.trim().length === 0) return null;
    return {
        id: identity.id,
        name: identity.name.trim(),
        color: identity.color,
        points: draft.points.map((p) => ({x: p.x, y: p.y}))
    };
}

/** Id for a newly drawn shape. Kept beside the commit helpers so every
 *  drawn shape is identified the same way, and out of them so those stay
 *  deterministic under test. */
export function newShapeId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chainSegments(
    points: readonly PlanPoint[],
    options: {closed: boolean}
): WallSegment[] {
    const out: WallSegment[] = [];
    for (let i = 1; i < points.length; i++) {
        out.push({from: {...points[i - 1]}, to: {...points[i]}});
    }
    const last = points.at(-1);
    if (options.closed && last && points.length > 2) {
        out.push({from: {...last}, to: {...points[0]}});
    }
    return out;
}

function isSamePoint(a: PlanPoint, b: PlanPoint): boolean {
    return (
        Math.abs(a.x - b.x) < MIN_VERTEX_GAP &&
        Math.abs(a.y - b.y) < MIN_VERTEX_GAP
    );
}
