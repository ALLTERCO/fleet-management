// SVG layered standard for floor plans.
// Inkscape-compatible. Each room and device is a labeled <g> layer so the
// FM can extract semantic structure without OCR or manual tagging.
//
// Standard layer tree (only inkscape:label values matter — ids are free):
//
//   Base                           ← page background (ignored)
//   Floor
//     Levels
//       Level1                     ← one floor per level
//         View                     ← floor outline (path)
//         Rooms
//           {ROOM-NAME}            ← e.g. "Kitchen", "Bedroom1"
//             View                 ← room outline (path)
//             Devices
//               {DEVICE-TYPE}      ← e.g. "Lights", "DoorWindow", "Mirror"
//                 View
//                   <circle cx cy r="10"/>   ← one circle per placement
//
// Coordinates in the SVG are SVG-space (e.g. 0..1050 × 0..720). Callers
// normalize to 0..1 against the floor-bounding box before persisting in
// `FloorPlanKindFields.devicePlacements`.

export interface ParsedFloorPlan {
    /** Floor outline as an absolute-coords polygon, derived from
     *  `Floor > Levels > Level1 > View` path data. Empty if not present. */
    floorOutline: Point[];
    /** Bounding box of the floor outline (or the SVG viewBox as fallback). */
    floorBox: BoundingBox;
    rooms: ParsedRoom[];
}

export interface ParsedRoom {
    name: string;
    /** Room outline as absolute-coords polygon. */
    outline: Point[];
    devices: ParsedDeviceMarker[];
}

export interface ParsedDeviceMarker {
    /** Device-type layer label, e.g. "Lights", "DoorWindow". */
    type: string;
    /** SVG-space center coordinates. */
    x: number;
    y: number;
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

export function parseFloorPlanSvg(svgText: string): ParsedFloorPlan {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName !== 'svg') {
        throw new Error('Not an SVG document');
    }
    const floorGroup = findLayer(svg, 'Floor');
    const levelGroup = floorGroup
        ? firstLayerChild(floorGroup, 'Levels')
        : null;
    const level1 = levelGroup ? firstLayerChild(levelGroup, 'Level1') : null;
    const floorView = level1 ? firstLayerChild(level1, 'View') : null;
    const floorOutline = floorView ? pathPoints(floorView) : [];
    const floorBox = floorOutline.length
        ? boundingBox(floorOutline)
        : viewBoxBox(svg);

    const roomsLayer = level1 ? firstLayerChild(level1, 'Rooms') : null;
    const rooms: ParsedRoom[] = [];
    if (roomsLayer) {
        for (const room of layerChildren(roomsLayer)) {
            rooms.push(parseRoom(room));
        }
    }
    return {floorOutline, floorBox, rooms};
}

function parseRoom(roomGroup: Element): ParsedRoom {
    const name = layerLabel(roomGroup) || roomGroup.id || 'Unnamed';
    const view = firstLayerChild(roomGroup, 'View');
    const outline = view ? pathPoints(view) : [];
    const devicesGroup = firstLayerChild(roomGroup, 'Devices');
    const devices: ParsedDeviceMarker[] = [];
    if (devicesGroup) {
        for (const typeGroup of layerChildren(devicesGroup)) {
            const type = layerLabel(typeGroup) || 'Unknown';
            for (const circle of collectCircles(typeGroup)) {
                devices.push({
                    type,
                    x: Number(circle.getAttribute('cx') ?? '0'),
                    y: Number(circle.getAttribute('cy') ?? '0')
                });
            }
        }
    }
    return {name, outline, devices};
}

function findLayer(root: Element, label: string): Element | null {
    const groups = Array.from(root.children).filter(isLayerGroup);
    for (const g of groups) {
        if (layerLabel(g) === label) return g;
        const nested = findLayer(g, label);
        if (nested) return nested;
    }
    return null;
}

function firstLayerChild(parent: Element, label: string): Element | null {
    for (const child of Array.from(parent.children)) {
        if (isLayerGroup(child) && layerLabel(child) === label) return child;
    }
    return null;
}

function layerChildren(parent: Element): Element[] {
    return Array.from(parent.children).filter(isLayerGroup);
}

function isLayerGroup(el: Element): boolean {
    if (el.tagName !== 'g') return false;
    return (
        el.getAttributeNS(INKSCAPE_NS, 'groupmode') === 'layer' ||
        el.getAttribute('inkscape:groupmode') === 'layer'
    );
}

function layerLabel(el: Element): string {
    return (
        el.getAttributeNS(INKSCAPE_NS, 'label') ??
        el.getAttribute('inkscape:label') ??
        ''
    );
}

function collectCircles(el: Element): Element[] {
    const out: Element[] = [];
    const stack: Element[] = [el];
    while (stack.length) {
        const next = stack.pop();
        if (!next) break;
        for (const child of Array.from(next.children)) {
            if (child.tagName === 'circle') out.push(child);
            else stack.push(child);
        }
    }
    return out;
}

// Path-data parser: supports M / L (absolute) and m / l / h / v (relative)
// — the subset that Inkscape emits for axis-aligned floor outlines. The
// floor-plan SVG standard is rectilinear, so curves/arcs aren't required.
function pathPoints(viewLayer: Element): Point[] {
    const path = viewLayer.querySelector('path');
    const d = path?.getAttribute('d');
    if (!d) return [];
    const points: Point[] = [];
    let cx = 0;
    let cy = 0;
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
    let i = 0;
    let cmd: string | null = null;
    while (i < tokens.length) {
        const tok = tokens[i];
        if (/[a-zA-Z]/.test(tok)) {
            cmd = tok;
            i++;
            continue;
        }
        if (!cmd) {
            i++;
            continue;
        }
        switch (cmd) {
            case 'M':
            case 'L':
                cx = Number(tokens[i]);
                cy = Number(tokens[i + 1]);
                points.push({x: cx, y: cy});
                i += 2;
                break;
            case 'm':
            case 'l':
                cx += Number(tokens[i]);
                cy += Number(tokens[i + 1]);
                points.push({x: cx, y: cy});
                i += 2;
                break;
            case 'H':
                cx = Number(tokens[i]);
                points.push({x: cx, y: cy});
                i += 1;
                break;
            case 'h':
                cx += Number(tokens[i]);
                points.push({x: cx, y: cy});
                i += 1;
                break;
            case 'V':
                cy = Number(tokens[i]);
                points.push({x: cx, y: cy});
                i += 1;
                break;
            case 'v':
                cy += Number(tokens[i]);
                points.push({x: cx, y: cy});
                i += 1;
                break;
            default:
                i++;
        }
    }
    return points;
}

function boundingBox(points: Point[]): BoundingBox {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
}

function viewBoxBox(svg: Element): BoundingBox {
    const vb = svg.getAttribute('viewBox');
    if (vb) {
        const [x, y, w, h] = vb.split(/\s+/).map(Number);
        return {x, y, width: w, height: h};
    }
    return {
        x: 0,
        y: 0,
        width: Number(svg.getAttribute('width') ?? '0'),
        height: Number(svg.getAttribute('height') ?? '0')
    };
}

// Normalize an SVG-space coordinate into 0..1 against the floor bounding
// box. Persisted device placements use normalized coords so re-uploading a
// plan at a different size keeps positions intact.
export function normalizeToFloor(
    p: Point,
    floorBox: BoundingBox
): {x: number; y: number} {
    if (!floorBox.width || !floorBox.height) return {x: 0, y: 0};
    return {
        x: (p.x - floorBox.x) / floorBox.width,
        y: (p.y - floorBox.y) / floorBox.height
    };
}
