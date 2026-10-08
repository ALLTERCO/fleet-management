// The one place that decides how geometry is read out of an uploaded plan.
//
// Decision D-032: pick by evidence, and say which evidence was picked. Layer
// names are the richest signal but survive only some export paths — Shelly's
// own Building 3 Floor 2 test fit loses all of them through PDF, and there
// colour is the only signal left. Neither works everywhere, so the resolver
// tries layers, then paint, then reports that it found nothing to go on.
//
// Everything downstream reads this result. No other module sniffs the file
// again — if a second reader disagreed about which strategy applied, the two
// halves of one import would come from different evidence.
//
// It always returns a report, including when it found nothing. "Zero walls"
// and "we never had anything to look at" are different facts and a user who
// cannot tell them apart cannot fix their file.

import {
    findLayersByLabel,
    layerLabel,
    readSvgDimensions,
    removeBaseLayer
} from '@/helpers/svg-floorplan';
import {
    classifyPaint,
    isUnpainted,
    parseSvgPaint,
    type PaintRole,
    toHexKey
} from '@/helpers/svg-paint';
import {
    isStructural,
    normalizeSegments,
    readGeometrySegments,
    SVG_GEOMETRY_SELECTOR,
    type SvgFloorPlanGeometry,
    type SvgWallSegment
} from '@/helpers/svg-walls';

/** Which evidence the geometry came from.
 *  `layer` — the drawing names its layers and at least one is a plan layer.
 *  `paint` — no usable layers; structure and zoning read from colour.
 *  `none`  — neither signal is present. Hand-drawing is the path forward. */
export type GeometryStrategy = 'layer' | 'paint' | 'none';

/** Why a resolve could not run at all — distinct from "ran and found none".
 *  `unreadable`    — the bytes are not parsable SVG.
 *  `no-dimensions` — parsable, but no viewBox and no width/height, so there
 *                    is no space to normalize coordinates into.
 *  `no-geometry`   — parsable and sized, but draws no geometry whatsoever. */
export type GeometryFailure = 'unreadable' | 'no-dimensions' | 'no-geometry';

/** Where wall segments came from, so an obviously wrong wall count can be
 *  traced to the rule that produced it. */
export type WallSource = 'layer' | 'fill-ink' | 'stroke-ink';

export interface PaintTally {
    /** `#rrggbb`. */
    readonly color: string;
    readonly role: PaintRole;
    readonly elements: number;
    /** Largest single region in this colour, as a share of the plan. */
    readonly largestAreaShare: number;
}

/** A filled region that *might* be a zone. It is evidence, never a decision:
 *  nothing here is persisted until a user names it and confirms. */
export interface ZoneCandidate {
    /** Stable within one resolve. */
    readonly key: string;
    /** The fill that proposed it, `#rrggbb` — a swatch for the user. */
    readonly color: string;
    /** Ring in normalized 0..1 plan coordinates, same space as device pins. */
    readonly points: ReadonlyArray<{readonly x: number; readonly y: number}>;
    /** Share of the plan covered, 0..1. Lets the UI sort big rooms first. */
    readonly areaShare: number;
    /** Other candidates sharing this colour. On the reference file one team
     *  is one colour across 3-9 regions, so this reads as "parts of this
     *  zone" and lets the UI offer naming them together. */
    readonly siblingCount: number;
    /** Proposed name when the drawing supplied one (layer strategy only).
     *  Null under the paint strategy: a colour is not a name. */
    readonly suggestedName: string | null;
}

export interface GeometryReport {
    readonly strategy: GeometryStrategy;
    /** Geometry elements considered, after templates and annotations. */
    readonly elementsScanned: number;
    /** Dropped as `<defs>`/`<symbol>` templates or dashed annotation. */
    readonly elementsAnnotation: number;
    /** Dropped because every one of their segments was shorter than the
     *  wall parser's minimum. Reported because it is the single biggest
     *  reduction on a detailed CAD export — 42,285 of 57,469 on the
     *  reference file — and a wall count that looks low is usually this. */
    readonly elementsBelowMinSize: number;
    /** Layer labels present in the file, whether or not they were usable —
     *  so "your layers are called X, Y, Z and none of them is a plan layer"
     *  is sayable. */
    readonly layersFound: readonly string[];
    readonly wallSource: WallSource | null;
    readonly wallElements: number;
    readonly wallSegments: number;
    /** Distinct paints, most-used first. The evidence behind the verdict. */
    readonly paints: readonly PaintTally[];
    readonly zoneCandidates: number;
    /** Elements that carried a paint value nothing could parse (gradients,
     *  exotic names). High counts explain a thin colour verdict. */
    readonly unparsedPaints: number;
    readonly parseMs: number;
    readonly resolveMs: number;
}

export interface FloorPlanGeometryResolution {
    readonly ok: boolean;
    readonly failure: GeometryFailure | null;
    /** Walls, bboxed and translated to the origin. Null when none were found
     *  — which the report explains rather than leaving to be guessed at. */
    readonly geometry: SvgFloorPlanGeometry | null;
    readonly zoneCandidates: readonly ZoneCandidate[];
    readonly report: GeometryReport;
}

/** Layer names that mean "the structure lives here", lowercased. */
const WALL_LAYER_NAMES = new Set(['wall', 'walls', 'structure']);

/** Layer names whose *children* are individual zones. */
const ZONE_LAYER_NAMES = new Set(['zone', 'zones', 'area', 'areas', 'rooms']);

// A tinted region smaller than this is a chair, a door swing or a legend
// swatch, not a room. Measured on the reference file: the largest single
// furniture fill covers 0.10% of the sheet and the largest floor-hatch tile
// 0.006%, while the smallest real team region is 0.23%. Sitting at 0.2%
// keeps every zone part the drawing has and still clears furniture by 2x.
const MIN_ZONE_AREA_SHARE = 0.002;

export function resolveFloorPlanGeometry(
    svgText: string
): FloorPlanGeometryResolution {
    const parseStart = now();
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const parseMs = now() - parseStart;

    const resolveStart = now();
    if (
        doc.querySelector('parsererror') ||
        doc.documentElement.tagName.toLowerCase() !== 'svg'
    ) {
        return failed('unreadable', {parseMs, resolveMs: now() - resolveStart});
    }
    const dims = readSvgDimensions(doc.documentElement);
    if (!dims || dims.width <= 0 || dims.height <= 0) {
        return failed('no-dimensions', {
            parseMs,
            resolveMs: now() - resolveStart
        });
    }

    // The Base layer is the page, not the plan — same rule as every other
    // reader, applied once here so the strategies below never see it.
    removeBaseLayer(doc);

    const scan = scanGeometry(doc, dims);
    if (scan.elements.length === 0) {
        return failed('no-geometry', {
            parseMs,
            resolveMs: now() - resolveStart,
            scan
        });
    }

    const chosen = byLayers(doc, scan) ?? byPaint(scan) ?? nothing();

    return {
        ok: true,
        failure: null,
        geometry: normalizeSegments(chosen.wallSegments),
        zoneCandidates: chosen.zoneCandidates,
        report: {
            strategy: chosen.strategy,
            elementsScanned: scan.elements.length,
            elementsAnnotation: scan.annotation,
            elementsBelowMinSize: scan.belowMinSize,
            layersFound: scan.layersFound,
            wallSource: chosen.wallSource,
            wallElements: chosen.wallElements,
            wallSegments: chosen.wallSegments.length,
            paints: tallyPaints(scan),
            zoneCandidates: chosen.zoneCandidates.length,
            unparsedPaints: scan.unparsedPaints,
            parseMs: round(parseMs),
            resolveMs: round(now() - resolveStart)
        }
    };
}

// ── one pass over the document ─────────────────────────────────────────

/** Everything the strategies need, read once. Re-walking 57k elements per
 *  strategy is the difference between a responsive import and a frozen tab. */
interface ScannedElement {
    readonly el: Element;
    readonly segments: readonly SvgWallSegment[];
    readonly fill: string | null;
    readonly fillRole: PaintRole | null;
    readonly strokeRole: PaintRole | null;
    /** Bounding-box area as a share of the plan, 0..1. */
    readonly areaShare: number;
}

interface PlanSize {
    readonly width: number;
    readonly height: number;
}

interface Scan {
    readonly elements: readonly ScannedElement[];
    readonly layersFound: readonly string[];
    readonly annotation: number;
    readonly belowMinSize: number;
    readonly unparsedPaints: number;
    /** The space candidate rings are normalized into — the same viewBox
     *  device pins use, so a zone and a pin from one file agree. */
    readonly dims: PlanSize;
}

function scanGeometry(doc: Document, dims: PlanSize): Scan {
    const planArea = dims.width * dims.height;
    const elements: ScannedElement[] = [];
    const layersFound = new Set<string>();
    let annotation = 0;
    let belowMinSize = 0;
    let unparsedPaints = 0;

    for (const g of Array.from(doc.getElementsByTagName('g'))) {
        const label = layerLabel(g);
        if (label) layersFound.add(label);
    }

    for (const el of Array.from(
        doc.querySelectorAll(SVG_GEOMETRY_SELECTOR)
    )) {
        if (!isStructural(el)) {
            annotation++;
            continue;
        }
        const segments = readGeometrySegments(el);
        if (segments.length === 0) {
            belowMinSize++;
            continue;
        }
        const fillRaw = inheritedPaint(el, 'fill');
        const strokeRaw = inheritedPaint(el, 'stroke');
        const fill = parseSvgPaint(fillRaw);
        const stroke = parseSvgPaint(strokeRaw);
        if (isUnreadablePaint(fillRaw, fill) || isUnreadablePaint(strokeRaw, stroke)) {
            unparsedPaints++;
        }
        elements.push({
            el,
            segments,
            fill: fill ? toHexKey(fill) : null,
            fillRole: fill ? classifyPaint(fill) : null,
            strokeRole: stroke ? classifyPaint(stroke) : null,
            areaShare: planArea > 0 ? boundingArea(segments) / planArea : 0
        });
    }
    return {
        elements,
        layersFound: [...layersFound],
        annotation,
        belowMinSize,
        unparsedPaints,
        dims
    };
}

// A value was written and nothing could make sense of it — a gradient url(),
// an exotic colour name. "none" is not that; it is a deliberate blank.
function isUnreadablePaint(raw: string | null, parsed: unknown): boolean {
    return raw !== null && parsed === null && !isUnpainted(raw);
}

// SVG paint inherits, and Inkscape writes it in `style` while CAD exporters
// write it as an attribute. Read both, nearest ancestor wins. An absent fill
// is left absent rather than defaulted to the spec's black: on a line drawing
// that default would turn every open stroke into a solid wall.
function inheritedPaint(el: Element, property: 'fill' | 'stroke'): string | null {
    for (let n: Element | null = el; n; n = n.parentElement) {
        const styled = readStyleProperty(n.getAttribute('style'), property);
        if (styled) return styled;
        const attr = n.getAttribute(property);
        if (attr) return attr;
    }
    return null;
}

function readStyleProperty(
    style: string | null,
    property: string
): string | null {
    if (!style) return null;
    for (const declaration of style.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 0) continue;
        if (declaration.slice(0, colon).trim().toLowerCase() !== property) {
            continue;
        }
        const value = declaration.slice(colon + 1).trim();
        if (value) return value;
    }
    return null;
}

// ── strategy 1: layer names ────────────────────────────────────────────

interface Chosen {
    readonly strategy: GeometryStrategy;
    readonly wallSource: WallSource | null;
    readonly wallElements: number;
    readonly wallSegments: readonly SvgWallSegment[];
    readonly zoneCandidates: readonly ZoneCandidate[];
}

// Only claims the file when a layer actually names a plan layer. A drawing
// with layers called "Layer 1" and "Layer 2" has names but no meaning, and
// falling through to colour is better than reporting an empty layer read.
function byLayers(doc: Document, scan: Scan): Chosen | null {
    const wallLayers = layersMatching(doc, scan.layersFound, WALL_LAYER_NAMES);
    const zoneLayers = layersMatching(doc, scan.layersFound, ZONE_LAYER_NAMES);
    if (wallLayers.length === 0 && zoneLayers.length === 0) return null;

    const inWalls = scan.elements.filter((s) =>
        wallLayers.some((layer) => layer.contains(s.el))
    );
    const zoneCandidates: ZoneCandidate[] = [];
    for (const zoneLayer of zoneLayers) {
        for (const child of Array.from(zoneLayer.children)) {
            const name = layerLabel(child);
            const members = scan.elements.filter((s) => child.contains(s.el));
            const region = members.find((s) => s.segments.length >= 3);
            if (!name || !region) continue;
            zoneCandidates.push(
                candidate({
                    index: zoneCandidates.length,
                    scanned: region,
                    dims: scan.dims,
                    suggestedName: name
                })
            );
        }
    }
    return {
        strategy: 'layer',
        wallSource: 'layer',
        wallElements: inWalls.length,
        wallSegments: inWalls.flatMap((s) => s.segments),
        zoneCandidates: withSiblingCounts(zoneCandidates)
    };
}

function layersMatching(
    doc: Document,
    found: readonly string[],
    vocabulary: ReadonlySet<string>
): Element[] {
    const out: Element[] = [];
    for (const label of found) {
        if (!vocabulary.has(label.trim().toLowerCase())) continue;
        out.push(...findLayersByLabel(doc, label));
    }
    return out;
}

// ── strategy 2: paint ──────────────────────────────────────────────────

// Structure is drawn in ink. Solid poché (an ink *fill*) is the strongest
// signal and the one the reference file uses — 1401 black-filled paths for
// the walls, against 27842 black *strokes* that are furniture outlines,
// dimension lines and leaders. Single-line drawings have no poché at all, so
// ink strokes are the fallback, and the report says which one was used.
function byPaint(scan: Scan): Chosen | null {
    const inkFilled = scan.elements.filter((s) => s.fillRole === 'ink');
    const inkStroked = scan.elements.filter(
        (s) => s.fillRole !== 'ink' && s.strokeRole === 'ink'
    );
    const walls = inkFilled.length > 0 ? inkFilled : inkStroked;
    const wallSource: WallSource | null =
        inkFilled.length > 0
            ? 'fill-ink'
            : inkStroked.length > 0
              ? 'stroke-ink'
              : null;

    const regions = scan.elements.filter(
        (s) => s.fillRole === 'tint' && s.areaShare >= MIN_ZONE_AREA_SHARE
    );
    if (wallSource === null && regions.length === 0) return null;

    const candidates = regions
        .slice()
        .sort((a, b) => b.areaShare - a.areaShare)
        .map((scanned, index) =>
            candidate({
                index,
                scanned,
                dims: scan.dims,
                suggestedName: null
            })
        );

    return {
        strategy: 'paint',
        wallSource,
        wallElements: walls.length,
        wallSegments: walls.flatMap((s) => s.segments),
        zoneCandidates: withSiblingCounts(candidates)
    };
}

function nothing(): Chosen {
    return {
        strategy: 'none',
        wallSource: null,
        wallElements: 0,
        wallSegments: [],
        zoneCandidates: []
    };
}

// ── candidates ─────────────────────────────────────────────────────────

function candidate(input: {
    index: number;
    scanned: ScannedElement;
    dims: PlanSize;
    suggestedName: string | null;
}): ZoneCandidate {
    const {index, scanned, dims, suggestedName} = input;
    return {
        key: `${index}:${scanned.fill ?? 'unpainted'}`,
        color: scanned.fill ?? '#000000',
        points: ringFromSegments(scanned.segments, dims),
        areaShare: scanned.areaShare,
        // Filled in by withSiblingCounts once the whole set is known.
        siblingCount: 0,
        suggestedName
    };
}

// One colour is one team on the reference file, spread over several regions.
// Counting them lets the UI say "5 regions" instead of listing five unnamed
// blobs the user has to recognise individually.
function withSiblingCounts(
    candidates: readonly ZoneCandidate[]
): ZoneCandidate[] {
    const perColor = new Map<string, number>();
    for (const c of candidates) {
        perColor.set(c.color, (perColor.get(c.color) ?? 0) + 1);
    }
    return candidates.map((c) => ({
        ...c,
        siblingCount: (perColor.get(c.color) ?? 1) - 1
    }));
}

// Segments already run end to end around a closed fill, so the ring is their
// start points, normalized into the plan's own 0..1 space — the space
// ZoneShape persists in and device pins already use.
function ringFromSegments(
    segments: readonly SvgWallSegment[],
    dims: PlanSize
): Array<{x: number; y: number}> {
    return segments.map((s) => ({
        x: clamp01(s.from[0] / dims.width),
        y: clamp01(s.from[1] / dims.height)
    }));
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function boundingArea(segments: readonly SvgWallSegment[]): number {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of segments) {
        for (const p of [s.from, s.to]) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
    }
    return (maxX - minX) * (maxY - minY);
}

// ── reporting ──────────────────────────────────────────────────────────

function tallyPaints(scan: Scan): PaintTally[] {
    const byColor = new Map<string, {role: PaintRole; n: number; max: number}>();
    for (const s of scan.elements) {
        if (!s.fill || !s.fillRole) continue;
        const entry = byColor.get(s.fill) ?? {
            role: s.fillRole,
            n: 0,
            max: 0
        };
        entry.n++;
        entry.max = Math.max(entry.max, s.areaShare);
        byColor.set(s.fill, entry);
    }
    return [...byColor.entries()]
        .map(([color, e]) => ({
            color,
            role: e.role,
            elements: e.n,
            largestAreaShare: e.max
        }))
        .sort((a, b) => b.elements - a.elements);
}

// A failure still reports everything that was learned before it. A file we
// could not size still tells the user which layers it has.
function failed(
    failure: GeometryFailure,
    partial: {parseMs: number; resolveMs: number; scan?: Scan}
): FloorPlanGeometryResolution {
    const scan = partial.scan;
    return {
        ok: false,
        failure,
        geometry: null,
        zoneCandidates: [],
        report: {
            strategy: 'none',
            elementsScanned: 0,
            elementsAnnotation: scan?.annotation ?? 0,
            elementsBelowMinSize: scan?.belowMinSize ?? 0,
            layersFound: scan?.layersFound ?? [],
            wallSource: null,
            wallElements: 0,
            wallSegments: 0,
            paints: [],
            zoneCandidates: 0,
            unparsedPaints: scan?.unparsedPaints ?? 0,
            parseMs: round(partial.parseMs),
            resolveMs: round(partial.resolveMs)
        }
    };
}

function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}
