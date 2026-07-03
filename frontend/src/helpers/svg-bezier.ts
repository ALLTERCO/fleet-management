// Bezier curve sampling — converts SVG curve commands into a polyline of
// straight segments that the wall extruder can extrude as box meshes.

import type {Point} from '@/helpers/svg-transform';

// Sample count — 8 line segments per curve is enough for the architectural
// arcs (door swings, curved walls) typical in floor plans. Higher values
// trade fidelity for wall mesh count.
const CURVE_SEGMENTS = 8;

// ───── primitives ──────────────────────────────────────────────────────

export function sampleCubicBezier(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point
): Point[] {
    return sampleAt(CURVE_SEGMENTS, (t) => cubicBezierPoint(p0, p1, p2, p3, t));
}

export function sampleQuadraticBezier(
    p0: Point,
    p1: Point,
    p2: Point
): Point[] {
    return sampleAt(CURVE_SEGMENTS, (t) => quadraticBezierPoint(p0, p1, p2, t));
}

// ───── math ────────────────────────────────────────────────────────────

function cubicBezierPoint(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    t: number
): Point {
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;
    return [
        u3 * p0[0] + 3 * u2 * t * p1[0] + 3 * u * t2 * p2[0] + t3 * p3[0],
        u3 * p0[1] + 3 * u2 * t * p1[1] + 3 * u * t2 * p2[1] + t3 * p3[1]
    ];
}

function quadraticBezierPoint(
    p0: Point,
    p1: Point,
    p2: Point,
    t: number
): Point {
    const u = 1 - t;
    return [
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    ];
}

// Builds the points list from `1..steps` (excludes t=0 — caller already
// has the start point as the previous segment's `to`). Result is `steps`
// points long.
function sampleAt(steps: number, pointAt: (t: number) => Point): Point[] {
    const out: Point[] = [];
    for (let i = 1; i <= steps; i++) out.push(pointAt(i / steps));
    return out;
}
