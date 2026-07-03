import type {LngLatBoundsLike} from 'maplibre-gl';
import type {MapPin} from '@/types/map';

// SW + NE corners — null when the input set is empty or has only one pin.
export function pinBounds(pins: readonly MapPin[]): LngLatBoundsLike | null {
    if (pins.length < 2) return null;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    for (const p of pins) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
    }
    return [
        [minLng, minLat],
        [maxLng, maxLat]
    ];
}

// Stable signature — drives dedupe so we don't re-fit on identical payloads.
export function pinPositionSignature(pins: readonly MapPin[]): string {
    return pins
        .map((p) => `${p.id}:${p.lat.toFixed(3)}:${p.lng.toFixed(3)}`)
        .join('|');
}
