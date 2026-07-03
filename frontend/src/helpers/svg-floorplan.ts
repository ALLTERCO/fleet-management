/** Inkscape SVG floor-plan adapter. Strips the "Base" layer (the white
 *  page background) and extracts the "Devices" layer (named circles =
 *  device positions). Pure DOM transforms — no fetch, no Pixi. */

const INKSCAPE_NAMESPACE = 'http://www.inkscape.org/namespaces/inkscape';

export interface SvgDevice {
    readonly label: string;
    /** "Light", "DoorWindow", etc. — the parent inkscape:label one level up. */
    readonly category: string;
    /** Normalized 0..1 against the SVG viewBox. */
    readonly x: number;
    readonly y: number;
}

/** Remove the inkscape "Base" layer; returns input unchanged if absent. */
export function stripInkscapeBaseLayer(svgText: string): string {
    const doc = parseSvg(svgText);
    if (!doc) return svgText;
    const base = findLayerByLabel(doc, 'Base');
    if (!base) return svgText;
    base.parentNode?.removeChild(base);
    return serializeSvg(doc);
}

/** Every device under any "Devices" layer; coords normalized to 0..1. */
export function extractDevicesFromSvg(svgText: string): SvgDevice[] {
    const doc = parseSvg(svgText);
    if (!doc) return [];
    const root = doc.documentElement;
    const dims = readSvgDimensions(root);
    if (!dims) return [];
    const devices: SvgDevice[] = [];
    for (const devicesLayer of findLayersByLabel(doc, 'Devices')) {
        collectDevicesFromLayer({devicesLayer, dims, into: devices});
    }
    return devices;
}

interface CollectInput {
    readonly devicesLayer: Element;
    readonly dims: {width: number; height: number};
    readonly into: SvgDevice[];
}

function collectDevicesFromLayer(input: CollectInput): void {
    // child layer = category (Light); grandchild = device (Light1).
    const categoryLayers = childInkscapeLayers(input.devicesLayer);
    for (const categoryLayer of categoryLayers) {
        const category = inkscapeLabel(categoryLayer) ?? 'Other';
        for (const deviceGroup of childInkscapeLayers(categoryLayer)) {
            const label = inkscapeLabel(deviceGroup);
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

function findLayerByLabel(doc: XMLDocument, label: string): Element | null {
    return findLayersByLabel(doc, label)[0] ?? null;
}

function findLayersByLabel(doc: XMLDocument, label: string): Element[] {
    const all = doc.getElementsByTagName('g');
    const matches: Element[] = [];
    for (let i = 0; i < all.length; i++) {
        const node = all.item(i);
        if (node && inkscapeLabel(node) === label) matches.push(node);
    }
    return matches;
}

function childInkscapeLayers(parent: Element): Element[] {
    const children: Element[] = [];
    for (const child of Array.from(parent.children)) {
        if (child.tagName.toLowerCase() === 'g' && inkscapeLabel(child)) {
            children.push(child);
        }
    }
    return children;
}

function inkscapeLabel(node: Element): string | null {
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

function readSvgDimensions(
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
