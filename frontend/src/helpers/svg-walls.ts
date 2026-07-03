// Auto-extract wall segments from an SVG floor plan.
//
// Strategy: parse every <path> in the document, ignore dashed strokes (those
// are dimension lines / annotations), tokenize the `d` attribute into
// straight-line segments, then collapse each segment into a {from, to} pair
// in SVG coordinate space. The 3D scene scales these into world units and
// extrudes them into wall boxes.

import {sampleCubicBezier, sampleQuadraticBezier} from '@/helpers/svg-bezier';
import {
    applyMatrixToPoint,
    composeMatrices,
    IDENTITY_MATRIX,
    type Matrix2D,
    type Point,
    parseTransformAttribute
} from '@/helpers/svg-transform';

export interface SvgWallSegment {
    /** Endpoints in SVG user units (the file's own coord system). */
    from: [number, number];
    to: [number, number];
}

export interface SvgFloorPlanGeometry {
    /** Width of the parsed-wall bounding box. Single source of truth for
     *  scaling: the floor plane + walls use these dimensions together so
     *  they always fit each other regardless of the SVG's declared
     *  width/height (which Qt SVGs set to physical mm, not user units). */
    width: number;
    /** Height of the parsed-wall bounding box. */
    height: number;
    /** Wall segments translated so the bbox min sits at (0, 0). */
    walls: SvgWallSegment[];
}

// Minimum segment length (SVG units) to count as a wall. Filters out tiny
// jogs introduced by rounded corners or dimension tick marks.
const MIN_SEGMENT_LEN = 5;

// Parse an SVG document into a geometry the 3D scene can extrude.
export async function loadSvgFloorPlanGeometry(
    url: string
): Promise<SvgFloorPlanGeometry | null> {
    const svgText = await fetchSvg(url);
    if (svgText == null) return null;
    return parseSvgFloorPlan(svgText);
}

async function fetchSvg(url: string): Promise<string | null> {
    const res = await fetch(url, {credentials: 'same-origin'});
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('svg')) return null;
    return res.text();
}

export function parseSvgFloorPlan(
    svgText: string
): SvgFloorPlanGeometry | null {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.tagName !== 'svg') return null;

    const raw: SvgWallSegment[] = [];
    for (const path of doc.querySelectorAll('path')) {
        if (!isStructuralPath(path)) continue;
        const matrix = readAccumulatedMatrix(path);
        const d = path.getAttribute('d');
        if (!d) continue;
        for (const seg of segmentsFromPath(d)) {
            const a = applyMatrixToPoint(matrix, seg.from);
            const b = applyMatrixToPoint(matrix, seg.to);
            if (distance(a, b) < MIN_SEGMENT_LEN) continue;
            raw.push({from: [a[0], a[1]], to: [b[0], b[1]]});
        }
    }
    if (raw.length === 0) return null;

    // Bbox of all parsed walls. Used as the canonical size — the floor mesh
    // and wall meshes scale against the same numbers so they always cover
    // identical ground area.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of raw) {
        if (w.from[0] < minX) minX = w.from[0];
        if (w.to[0] < minX) minX = w.to[0];
        if (w.from[1] < minY) minY = w.from[1];
        if (w.to[1] < minY) minY = w.to[1];
        if (w.from[0] > maxX) maxX = w.from[0];
        if (w.to[0] > maxX) maxX = w.to[0];
        if (w.from[1] > maxY) maxY = w.from[1];
        if (w.to[1] > maxY) maxY = w.to[1];
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 || height <= 0) return null;

    // Translate so the bbox starts at (0, 0).
    const walls = raw.map(
        (w): SvgWallSegment => ({
            from: [w.from[0] - minX, w.from[1] - minY],
            to: [w.to[0] - minX, w.to[1] - minY]
        })
    );
    return {width, height, walls};
}

// Structural paths are those without dashed strokes. Qt-generated plans use
// stroke-dasharray for dimension lines and solid strokes for the structure.
function isStructuralPath(path: Element): boolean {
    if (hasDashedStroke(path)) return false;
    for (let n: Element | null = path.parentElement; n; n = n.parentElement) {
        if (hasDashedStroke(n)) return false;
    }
    return true;
}

function hasDashedStroke(el: Element): boolean {
    const dash = el.getAttribute('stroke-dasharray');
    if (!dash || dash === 'none') return false;
    return dash.trim().length > 0;
}

// Walks the parent chain bottom-up and composes every group's `transform`
// attribute into a single matrix. Compose order is outer ∘ inner so the
// outermost group's transform wraps the others — matches SVG semantics.
function readAccumulatedMatrix(el: Element): Matrix2D {
    let m: Matrix2D = IDENTITY_MATRIX;
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        const t = n.getAttribute('transform');
        if (!t) continue;
        m = composeMatrices(parseTransformAttribute(t), m);
    }
    return m;
}

interface Segment {
    from: [number, number];
    to: [number, number];
}

// SVG `d` → straight-line segments. Lines pass through as exact segments;
// cubic + quadratic beziers are sampled into a polyline. Arc (A) and
// smooth-bezier (S/T) commands are dropped — not worth the complexity for
// architectural plans, and their operands are skipped by the outer loop.
function segmentsFromPath(d: string): Segment[] {
    const cursor: PathCursor = {
        tokens: tokenizePath(d),
        i: 0,
        cx: 0,
        cy: 0,
        startX: 0,
        startY: 0,
        segments: []
    };
    while (cursor.i < cursor.tokens.length) {
        const token = cursor.tokens[cursor.i];
        if (typeof token !== 'string') {
            cursor.i++;
            continue;
        }
        const handler = COMMAND_HANDLERS[token];
        cursor.i++;
        if (handler) handler(cursor, isAbsoluteCommand(token));
    }
    return cursor.segments;
}

interface PathCursor {
    readonly tokens: PathToken[];
    i: number;
    cx: number;
    cy: number;
    startX: number;
    startY: number;
    readonly segments: Segment[];
}

type CommandHandler = (cursor: PathCursor, absolute: boolean) => void;

// Strategy map: each SVG command is one handler. Adding S/T/A in the future
// is a matter of dropping another entry here.
const COMMAND_HANDLERS: Record<string, CommandHandler> = {
    M: handleMove,
    m: handleMove,
    L: handleLine,
    l: handleLine,
    H: handleHorizontal,
    h: handleHorizontal,
    V: handleVertical,
    v: handleVertical,
    Z: handleClose,
    z: handleClose,
    C: handleCubic,
    c: handleCubic,
    Q: handleQuadratic,
    q: handleQuadratic
};

function isAbsoluteCommand(cmd: string): boolean {
    return cmd === cmd.toUpperCase();
}

function handleMove(cursor: PathCursor, absolute: boolean): void {
    const x = num(cursor.tokens, cursor.i++);
    const y = num(cursor.tokens, cursor.i++);
    cursor.cx = absolute ? x : cursor.cx + x;
    cursor.cy = absolute ? y : cursor.cy + y;
    cursor.startX = cursor.cx;
    cursor.startY = cursor.cy;
    // SVG semantics: subsequent number pairs after M/m are implicit L/l.
    consumePairs(cursor, {absolute, emit: pushLineSegment});
}

function handleLine(cursor: PathCursor, absolute: boolean): void {
    consumePairs(cursor, {absolute, emit: pushLineSegment});
}

function handleHorizontal(cursor: PathCursor, absolute: boolean): void {
    consumeSingles(
        cursor,
        absolute,
        (c) => c.cx,
        (c, n) => {
            c.segments.push({from: [c.cx, c.cy], to: [n, c.cy]});
            c.cx = n;
        }
    );
}

function handleVertical(cursor: PathCursor, absolute: boolean): void {
    consumeSingles(
        cursor,
        absolute,
        (c) => c.cy,
        (c, n) => {
            c.segments.push({from: [c.cx, c.cy], to: [c.cx, n]});
            c.cy = n;
        }
    );
}

function handleClose(cursor: PathCursor, _absolute: boolean): void {
    if (cursor.cx !== cursor.startX || cursor.cy !== cursor.startY) {
        cursor.segments.push({
            from: [cursor.cx, cursor.cy],
            to: [cursor.startX, cursor.startY]
        });
    }
    cursor.cx = cursor.startX;
    cursor.cy = cursor.startY;
}

function handleCubic(cursor: PathCursor, absolute: boolean): void {
    while (canReadPairs(cursor.tokens, {i: cursor.i, pairs: 3})) {
        const c1 = readControl(
            cursor.tokens,
            cursor.i,
            !absolute,
            cursor.cx,
            cursor.cy
        );
        const c2 = readControl(
            cursor.tokens,
            cursor.i + 2,
            !absolute,
            cursor.cx,
            cursor.cy
        );
        const end = readControl(
            cursor.tokens,
            cursor.i + 4,
            !absolute,
            cursor.cx,
            cursor.cy
        );
        cursor.i += 6;
        appendBezierSegments(
            cursor.segments,
            [cursor.cx, cursor.cy],
            sampleCubicBezier([cursor.cx, cursor.cy], c1, c2, end)
        );
        cursor.cx = end[0];
        cursor.cy = end[1];
    }
}

function handleQuadratic(cursor: PathCursor, absolute: boolean): void {
    while (canReadPairs(cursor.tokens, {i: cursor.i, pairs: 2})) {
        const c1 = readControl(
            cursor.tokens,
            cursor.i,
            !absolute,
            cursor.cx,
            cursor.cy
        );
        const end = readControl(
            cursor.tokens,
            cursor.i + 2,
            !absolute,
            cursor.cx,
            cursor.cy
        );
        cursor.i += 4;
        appendBezierSegments(
            cursor.segments,
            [cursor.cx, cursor.cy],
            sampleQuadraticBezier([cursor.cx, cursor.cy], c1, end)
        );
        cursor.cx = end[0];
        cursor.cy = end[1];
    }
}

// Consume successive (x, y) pairs from the token stream until a non-pair
// is encountered, emitting a line segment for each one.
function consumePairs(
    cursor: PathCursor,
    options: {
        absolute: boolean;
        emit: (cursor: PathCursor, target: {nx: number; ny: number}) => void;
    }
): void {
    while (
        cursor.i < cursor.tokens.length &&
        typeof cursor.tokens[cursor.i] === 'number' &&
        typeof cursor.tokens[cursor.i + 1] === 'number'
    ) {
        const dx = num(cursor.tokens, cursor.i++);
        const dy = num(cursor.tokens, cursor.i++);
        const nx = options.absolute ? dx : cursor.cx + dx;
        const ny = options.absolute ? dy : cursor.cy + dy;
        options.emit(cursor, {nx, ny});
    }
}

// Companion to consumePairs for single-coordinate commands (H/V). The base
// reader runs after each emit so relative offsets see the latest cursor state.
function consumeSingles(
    cursor: PathCursor,
    absolute: boolean,
    readBase: (cursor: PathCursor) => number,
    emit: (cursor: PathCursor, n: number) => void
): void {
    while (
        cursor.i < cursor.tokens.length &&
        typeof cursor.tokens[cursor.i] === 'number'
    ) {
        const d = num(cursor.tokens, cursor.i++);
        const n = absolute ? d : readBase(cursor) + d;
        emit(cursor, n);
    }
}

function pushLineSegment(
    cursor: PathCursor,
    target: {nx: number; ny: number}
): void {
    cursor.segments.push({
        from: [cursor.cx, cursor.cy],
        to: [target.nx, target.ny]
    });
    cursor.cx = target.nx;
    cursor.cy = target.ny;
}

// Returns true when at least `pairs` (x, y) coordinate pairs are still
// available starting at `i`. Lets the curve loops stop cleanly when a new
// command appears.
function canReadPairs(
    tokens: PathToken[],
    request: {i: number; pairs: number}
): boolean {
    for (let k = 0; k < request.pairs * 2; k++) {
        if (typeof tokens[request.i + k] !== 'number') return false;
    }
    return true;
}

// Reads (x, y) at `i` and resolves it to an absolute Point. Relative
// commands offset by (cx, cy); absolute commands use the values as-is.
function readControl(
    tokens: PathToken[],
    i: number,
    relative: boolean,
    cx: number,
    cy: number
): Point {
    const x = num(tokens, i);
    const y = num(tokens, i + 1);
    return relative ? [cx + x, cy + y] : [x, y];
}

// Joins the sampled curve points into successive line segments anchored to
// the previous endpoint, matching the polyline shape the wall extruder
// already consumes.
function appendBezierSegments(
    out: Segment[],
    start: Point,
    sampled: Point[]
): void {
    let prev: Point = start;
    for (const p of sampled) {
        out.push({from: [prev[0], prev[1]], to: [p[0], p[1]]});
        prev = p;
    }
}

type PathToken = string | number;

function tokenizePath(d: string): PathToken[] {
    const out: PathToken[] = [];
    const re = /([MmLlHhVvZzCcSsQqTtAa])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
    let match: RegExpExecArray | null = re.exec(d);
    while (match !== null) {
        if (match[1] != null) {
            out.push(match[1]);
        } else if (match[2] != null) {
            out.push(Number.parseFloat(match[2]));
        }
        match = re.exec(d);
    }
    return out;
}

function num(tokens: PathToken[], i: number): number {
    const t = tokens[i];
    return typeof t === 'number' ? t : 0;
}

function distance(a: Point, b: Point): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}
