/** Inkscape SVG floor-plan adapter. Strips the "Base" layer (the white
 *  page background) and extracts the "Devices" layer (named circles =
 *  device positions). Pure DOM transforms — no fetch, no Pixi. */

const INKSCAPE_NAMESPACE = 'http://www.inkscape.org/namespaces/inkscape';

// Upload sanitizing (backend/src/modules/svgSanitize.ts) drops namespaced
// attributes, so it mirrors inkscape:label onto this one.
const MIRRORED_LABEL_ATTRIBUTE = 'data-layer';

export interface SvgDevice {
    readonly label: string;
    /** "Light", "DoorWindow", etc. — the parent layer label one level up. */
    readonly category: string;
    /** Normalized 0..1 against the SVG viewBox. */
    readonly x: number;
    readonly y: number;
}

/** Remove the inkscape "Base" layer; returns input unchanged if absent. */
export function stripInkscapeBaseLayer(svgText: string): string {
    const doc = parseSvg(svgText);
    if (!doc) return svgText;
    if (!removeBaseLayer(doc)) return svgText;
    return serializeSvg(doc);
}

/** The one definition of "Base is the page, not the plan". Texture readers and
 *  the wall-geometry parser both go through this, so a full-page background
 *  rect is never mistaken for content. Returns true when a layer was removed.
 *
 *  Limit: only a rect inside a layer *labelled* Base is recognised. A bare
 *  background rect at the document root is still treated as content. */
export function removeBaseLayer(doc: Document): boolean {
    const base = findLayerByLabel(doc, 'Base');
    if (!base) return false;
    base.parentNode?.removeChild(base);
    return true;
}

/** Why an extraction could not run.
 *  `unreadable`     — the text is not parsable SVG.
 *  `no-dimensions`  — parsable, but no viewBox and no width+height, so
 *                     there is nothing to normalize coordinates against. */
export type SvgExtractionFailure = 'unreadable' | 'no-dimensions';

export type SvgDeviceExtraction =
    | {readonly ok: true; readonly devices: SvgDevice[]}
    | {readonly ok: false; readonly reason: SvgExtractionFailure};

/** Every device under any "Devices" layer; coords normalized to 0..1.
 *  Answers *why* nothing came back, because "we could not read your file"
 *  and "your file draws no devices" call for different words in the UI. */
export function readDevicesFromSvg(svgText: string): SvgDeviceExtraction {
    const doc = parseSvg(svgText);
    if (!doc) return {ok: false, reason: 'unreadable'};
    const dims = readSvgDimensions(doc.documentElement);
    if (!dims) return {ok: false, reason: 'no-dimensions'};
    const devices: SvgDevice[] = [];
    for (const devicesLayer of findLayersByLabel(doc, 'Devices')) {
        collectDevicesFromLayer({devicesLayer, dims, into: devices});
    }
    return {ok: true, devices};
}

/** Devices only, with failures flattened to an empty list. For callers that
 *  render a plan and can do nothing about a bad file. Anything that reports
 *  the outcome to a user takes readDevicesFromSvg instead. */
export function extractDevicesFromSvg(svgText: string): SvgDevice[] {
    const extraction = readDevicesFromSvg(svgText);
    return extraction.ok ? extraction.devices : [];
}

/** A plan URL that points at SVG source we can read layers from. Raster
 *  plans (PNG/JPG/WebP) carry no layer tree. */
export function isSvgPlanUrl(url: string): boolean {
    return /\.svg(\?|#|$)/i.test(url);
}

interface CollectInput {
    readonly devicesLayer: Element;
    readonly dims: {width: number; height: number};
    readonly into: SvgDevice[];
}

function collectDevicesFromLayer(input: CollectInput): void {
    // child layer = category (Light); grandchild = device (Light1).
    const categoryLayers = childLayers(input.devicesLayer);
    for (const categoryLayer of categoryLayers) {
        const category = layerLabel(categoryLayer) ?? 'Other';
        for (const deviceGroup of childLayers(categoryLayer)) {
            const label = layerLabel(deviceGroup);
            const center = firstCircleCenter(deviceGroup);
            if (!label || !center) continue;
            input.into.push({
                label,
                category,
                x: clamp01(center.x / input.dims.width),
                y: clamp01(center.y / input.dims.height)
            });
        }
    }
}

function parseSvg(svgText: string): XMLDocument | null {
    if (typeof DOMParser === 'undefined') return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    return doc;
}

function serializeSvg(doc: XMLDocument): string {
    return new XMLSerializer().serializeToString(doc);
}

function findLayerByLabel(doc: Document, label: string): Element | null {
    return findLayersByLabel(doc, label)[0] ?? null;
}

/** Every `<g>` carrying `label`, case-sensitive as the drawing spells it. */
export function findLayersByLabel(doc: Document, label: string): Element[] {
    const all = doc.getElementsByTagName('g');
    const matches: Element[] = [];
    for (let i = 0; i < all.length; i++) {
        const node = all.item(i);
        if (node && layerLabel(node) === label) matches.push(node);
    }
    return matches;
}

function childLayers(parent: Element): Element[] {
    const children: Element[] = [];
    for (const child of Array.from(parent.children)) {
        if (child.tagName.toLowerCase() === 'g' && layerLabel(child)) {
            children.push(child);
        }
    }
    return children;
}

/** The one place a layer's label is read. Everything else goes through it. */
export function layerLabel(node: Element): string | null {
    // A stored (sanitized) plan carries the mirrored form; a file opened
    // straight from Inkscape still carries the original namespaced one.
    const mirrored = node.getAttribute(MIRRORED_LABEL_ATTRIBUTE);
    if (mirrored) return mirrored;
    // jsdom and browsers diverge on how prefixed attrs are stored after
    // XML parsing. Try both lookups and treat empty strings as "absent".
    const direct = node.getAttribute('inkscape:label');
    if (direct) return direct;
    const ns = node.getAttributeNS(INKSCAPE_NAMESPACE, 'label');
    return ns && ns.length > 0 ? ns : null;
}

function firstCircleCenter(group: Element): {x: number; y: number} | null {
    const circle = group.getElementsByTagName('circle').item(0);
    if (!circle) return null;
    const cx = Number.parseFloat(circle.getAttribute('cx') ?? '');
    const cy = Number.parseFloat(circle.getAttribute('cy') ?? '');
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return applyAncestorScale(group, {x: cx, y: cy});
}

// Walk up the tree and multiply uniform scale() transforms so the cx/cy
// in the group's local coords end up in the SVG's own units.
function applyAncestorScale(
    group: Element,
    point: {x: number; y: number}
): {x: number; y: number} {
    let scale = 1;
    let node: Element | null = group;
    while (node) {
        const tx = node.getAttribute('transform');
        if (tx) scale *= readUniformScale(tx);
        node = node.parentElement;
    }
    return {x: point.x * scale, y: point.y * scale};
}

function readUniformScale(transform: string): number {
    const match = /scale\(\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
    if (!match) return 1;
    const v = Number.parseFloat(match[1]);
    return Number.isFinite(v) && v !== 0 ? v : 1;
}

/** The coordinate space every normalized 0..1 plan coordinate is measured
 *  against — viewBox first, declared width/height second. Device markers and
 *  zone candidates both go through this, so a pin and a zone drawn from the
 *  same file land in the same space. Null when the file declares neither. */
export function readSvgDimensions(
    root: Element
): {width: number; height: number} | null {
    const viewBox = root.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.trim().split(/\s+/).map(Number.parseFloat);
        if (parts.length === 4 && parts.every(Number.isFinite)) {
            return {width: parts[2], height: parts[3]};
        }
    }
    const width = readLength(root.getAttribute('width'));
    const height = readLength(root.getAttribute('height'));
    if (width === null || height === null) return null;
    return {width, height};
}

function readLength(raw: string | null): number | null {
    if (!raw) return null;
    const match = /^(-?\d+(?:\.\d+)?)(?:px|mm|cm|pt|in)?$/.exec(raw.trim());
    if (!match) return null;
    const v = Number.parseFloat(match[1]);
    return Number.isFinite(v) ? v : null;
}

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}
