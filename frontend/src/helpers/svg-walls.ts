// Auto-extract wall segments from an SVG floor plan.
//
// Strategy: reduce every geometry element in the document to straight-line
// segments, ignore dashed strokes (those are dimension lines / annotations),
// then collapse each segment into a {from, to} pair in SVG coordinate space.
// The 3D scene scales these into world units and extrudes them into wall
// boxes.
//
// Inkscape emits walls as <path>, but CAD and Illustrator exports use
// <line>, <rect>, <polyline> and <polygon> just as often, so all five feed
// the same segment pipeline.

import {sampleCubicBezier, sampleQuadraticBezier} from '@/helpers/svg-bezier';
import {removeBaseLayer} from '@/helpers/svg-floorplan';
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

    // The Base layer is the page, not the plan — the same rule the texture
    // readers apply. Without it the full-page background rect becomes a
    // perimeter wall and stretches the bbox to the paper size.
    removeBaseLayer(doc);

    const raw: SvgWallSegment[] = [];
    for (const el of doc.querySelectorAll(SVG_GEOMETRY_SELECTOR)) {
        if (!isStructural(el)) continue;
        raw.push(...readGeometrySegments(el));
    }
    return normalizeSegments(raw);
}

/** One geometry element → straight segments in the document's own coordinate
 *  space (ancestor transforms applied, sub-wall jitter dropped). The single
 *  `d`/`points` parser in the app; nothing re-implements it. */
export function readGeometrySegments(el: Element): SvgWallSegment[] {
    const matrix = readAccumulatedMatrix(el);
    const out: SvgWallSegment[] = [];
    for (const seg of segmentsFromElement(el)) {
        const a = applyMatrixToPoint(matrix, seg.from);
        const b = applyMatrixToPoint(matrix, seg.to);
        if (distance(a, b) < MIN_SEGMENT_LEN) continue;
        out.push({from: [a[0], a[1]], to: [b[0], b[1]]});
    }
    return out;
}

/** Bbox the segments and translate them so it starts at (0, 0). The canonical
 *  size — the floor mesh and wall meshes scale against the same numbers so
 *  they always cover identical ground area. Null when there is nothing, or
 *  nothing two-dimensional, to scale against. */
export function normalizeSegments(
    raw: readonly SvgWallSegment[]
): SvgFloorPlanGeometry | null {
    if (raw.length === 0) return null;

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

    const walls = raw.map(
        (w): SvgWallSegment => ({
            from: [w.from[0] - minX, w.from[1] - minY],
            to: [w.to[0] - minX, w.to[1] - minY]
        })
    );
    return {width, height, walls};
}

/** The one rule that decides whether an element is structure or annotation,
 *  applied to every geometry tag. Qt-generated plans use stroke-dasharray for
 *  dimension lines and solid strokes for the structure. Exported so the
 *  resolver filters annotations by the same rule rather than its own. */
export function isStructural(el: Element): boolean {
    if (hasDashedStroke(el)) return false;
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        if (hasDashedStroke(n)) return false;
        if (TEMPLATE_TAGS.has(n.tagName.toLowerCase())) return false;
    }
    return true;
}

// Content under these is a template referenced by <use>, not drawn geometry.
// pdftocairo puts 260 text-glyph outlines in <defs>; counting them as walls
// would seed the bbox with letter shapes sitting near the origin.
const TEMPLATE_TAGS = new Set([
    'defs',
    'symbol',
    'clippath',
    'mask',
    'marker',
    'pattern'
]);

function hasDashedStroke(el: Element): boolean {
    const dash = el.getAttribute('stroke-dasharray');
    if (!dash || dash === 'none') return false;
    return dash.trim().length > 0;
}

// Walks from the element itself up the parent chain and composes every
// `transform` attribute into a single matrix. Compose order is outer ∘ inner
// so the outermost group's transform wraps the others — matches SVG semantics.
//
// Starts at `el`, not at its parent: an element's own transform applies to its
// own geometry. pdftocairo puts the whole page transform (including a Y flip)
// on every single path, so skipping it renders the plan mirrored.
function readAccumulatedMatrix(el: Element): Matrix2D {
    let m: Matrix2D = IDENTITY_MATRIX;
    for (let n: Element | null = el; n; n = n.parentElement) {
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

type GeometryReader = (el: Element) => Segment[];

// Strategy map, same shape as COMMAND_HANDLERS: one entry per supported tag.
// Adding a shape is one entry here and nothing else — the query selector is
// derived from these keys so the two can never drift apart.
const GEOMETRY_READERS: Record<string, GeometryReader> = {
    path: (el) => segmentsFromPath(el.getAttribute('d') ?? ''),
    line: segmentsFromLine,
    rect: segmentsFromRect,
    polyline: (el) => segmentsFromPointList(el, {closed: false}),
    polygon: (el) => segmentsFromPointList(el, {closed: true})
};

/** Every tag this module can turn into line segments. The geometry resolver
 *  queries with the same string, so the two can never disagree about what
 *  counts as geometry. */
export const SVG_GEOMETRY_SELECTOR: string =
    Object.keys(GEOMETRY_READERS).join(', ');

function segmentsFromElement(el: Element): Segment[] {
    return GEOMETRY_READERS[el.tagName.toLowerCase()](el);
}

function segmentsFromLine(el: Element): Segment[] {
    return [
        {
            from: [numberAttribute(el, 'x1'), numberAttribute(el, 'y1')],
            to: [numberAttribute(el, 'x2'), numberAttribute(el, 'y2')]
        }
    ];
}

// Rounded corners (rx/ry) are extruded as sharp ones: walls are straight
// boxes downstream, and a corner radius on an architectural plan is well
// under MIN_SEGMENT_LEN anyway.
function segmentsFromRect(el: Element): Segment[] {
    const x = numberAttribute(el, 'x');
    const y = numberAttribute(el, 'y');
    const width = numberAttribute(el, 'width');
    const height = numberAttribute(el, 'height');
    // Per the SVG spec a rect with a zero dimension is not rendered at all.
    if (width <= 0 || height <= 0) return [];
    return chainSegments(
        [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height]
        ],
        {closed: true}
    );
}

function segmentsFromPointList(
    el: Element,
    options: {closed: boolean}
): Segment[] {
    const points = parsePointList(el.getAttribute('points') ?? '');
    if (points.length < 2) return [];
    return chainSegments(points, options);
}

// Successive points as segments; `closed` adds the last → first edge that
// makes a polygon (and a rect) a ring rather than an open chain.
function chainSegments(
    points: readonly Point[],
    options: {closed: boolean}
): Segment[] {
    const out: Segment[] = [];
    for (let i = 1; i < points.length; i++) {
        out.push(segment(points[i - 1], points[i]));
    }
    if (options.closed) {
        out.push(segment(points[points.length - 1], points[0]));
    }
    return out;
}

function segment(from: Point, to: Point): Segment {
    return {from: [from[0], from[1]], to: [to[0], to[1]]};
}

// A `points` attribute separates numbers by commas, whitespace, or both —
// real Illustrator output mixes them inside one file.
function parsePointList(raw: string): Point[] {
    const numbers = raw.match(new RegExp(NUMBER_SOURCE, 'g')) ?? [];
    const points: Point[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
        points.push([
            Number.parseFloat(numbers[i]),
            Number.parseFloat(numbers[i + 1])
        ]);
    }
    return points;
}

// SVG defaults an absent geometry attribute to 0, and so do we for an
// unparseable one — a shape is never dropped for a single bad coordinate.
function numberAttribute(el: Element, name: string): number {
    const v = Number.parseFloat(el.getAttribute(name) ?? '');
    return Number.isFinite(v) ? v : 0;
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

// One grammar for "a number in an SVG attribute". The `d` tokenizer and the
// `points` reader must agree on what counts as a number.
const NUMBER_SOURCE = String.raw`-?\d*\.?\d+(?:[eE][+-]?\d+)?`;

function tokenizePath(d: string): PathToken[] {
    const out: PathToken[] = [];
    const re = new RegExp(`([MmLlHhVvZzCcSsQqTtAa])|(${NUMBER_SOURCE})`, 'g');
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
