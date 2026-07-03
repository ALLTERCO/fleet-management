// Great-circle distance between two lat/lng points, in metres. Pure.

export interface LatLng {
    lat: number;
    lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
    return (deg * Math.PI) / 180;
}

export function geoDistanceMeters(a: LatLng, b: LatLng): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(a.lat)) *
            Math.cos(toRadians(b.lat)) *
            Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
