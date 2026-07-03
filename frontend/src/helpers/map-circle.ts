/** Build a GeoJSON Polygon approximating a circle on Earth's surface. */

const EARTH_RADIUS_M = 6378137;
const DEG_PER_RAD = 180 / Math.PI;

export interface CircleSpec {
    readonly center: {lat: number; lng: number};
    readonly radiusMeters: number;
    /** Vertex count; clamps to [12, 256] so callers can't ask for a triangle
     *  or melt the GPU. Defaults to a smooth 64. */
    readonly segments?: number;
}

export function circlePolygon(
    spec: CircleSpec
): GeoJSON.Feature<GeoJSON.Polygon> {
    const segments = clampSegments(spec.segments);
    const ring = buildRing(spec.center, spec.radiusMeters, segments);
    return {
        type: 'Feature',
        geometry: {type: 'Polygon', coordinates: [ring]},
        properties: {}
    };
}

function clampSegments(raw: number | undefined): number {
    if (raw === undefined) return 64;
    if (!Number.isFinite(raw)) return 64;
    return Math.max(12, Math.min(256, Math.round(raw)));
}

function buildRing(
    center: {lat: number; lng: number},
    radiusMeters: number,
    segments: number
): [number, number][] {
    const {dLat, dLng} = degreeDeltas(center.lat, radiusMeters);
    const ring: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        ring.push([
            center.lng + dLng * Math.cos(angle),
            center.lat + dLat * Math.sin(angle)
        ]);
    }
    return ring;
}

// Latitude degree per meter is constant; longitude shrinks with cos(lat).
function degreeDeltas(
    latDeg: number,
    radiusMeters: number
): {dLat: number; dLng: number} {
    const latRad = latDeg / DEG_PER_RAD;
    const dLat = (radiusMeters / EARTH_RADIUS_M) * DEG_PER_RAD;
    const dLng = dLat / Math.cos(latRad);
    return {dLat, dLng};
}
