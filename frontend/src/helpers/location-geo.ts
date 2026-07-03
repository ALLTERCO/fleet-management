/** Single source of truth for "does this location have a usable lat/lng?".
 *  Same shape and validation as the focus-card composable; extracted so the
 *  detail-panel inset can share it without dragging in the composable. */

import type {ApiLocation} from '@/stores/locations';

export interface LocationGeo {
    readonly lat: number;
    readonly lng: number;
}

export function locationGeoLatLng(loc: ApiLocation): LocationGeo | null {
    const geo = (loc.kindFields as Record<string, unknown>)?.geo as
        | {lat?: number; lng?: number}
        | null
        | undefined;
    if (!geo) return null;
    const lat = geo.lat ?? Number.NaN;
    const lng = geo.lng ?? Number.NaN;
    if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
    ) {
        return null;
    }
    return {lat, lng};
}
