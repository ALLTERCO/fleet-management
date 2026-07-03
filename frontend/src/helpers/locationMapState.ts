import type {Location as ApiLocation} from '@api/location';
import type {LocationHealth} from '@/composables/useLocationStatus';
import type {MapPin} from '@/types/map';

interface GeoFields {
    lat: number;
    lng: number;
}

interface AddressFields {
    city?: string;
    region?: string;
    countryCode?: string;
}

export interface UnmappedLocation {
    id: number;
    name: string;
    summary: string;
}

export interface LocationMapState {
    pins: MapPin[];
    unmapped: UnmappedLocation[];
}

export function locationMapState(
    locations: ApiLocation[],
    health?: Map<number, LocationHealth>,
    alertsByLocation?: Map<number, number>
): LocationMapState {
    const pins: MapPin[] = [];
    const unmapped: UnmappedLocation[] = [];

    for (const location of locations) {
        const pin = locationMapPin(
            location,
            health?.get(location.id),
            alertsByLocation?.get(location.id) ?? 0
        );
        if (pin) {
            pins.push(pin);
            continue;
        }

        const summary =
            location.coordinateStatus?.summary ||
            locationAddressSummary(location);
        if (summary) {
            unmapped.push({id: location.id, name: location.name, summary});
        }
    }

    return {pins, unmapped};
}

function locationMapPin(
    location: ApiLocation,
    health: LocationHealth | undefined,
    alertCount: number
): MapPin | null {
    const geo = locationGeo(location);
    if (!geo) return null;
    const pin: MapPin = {
        id: String(location.id),
        lat: geo.lat,
        lng: geo.lng,
        label: location.name,
        kind: location.kind
    };
    if (health) pin.status = health.status;
    if (alertCount > 0) pin.alertCount = alertCount;
    return pin;
}

function locationGeo(location: ApiLocation): GeoFields | null {
    const geo = locationFields(location).geo as GeoFields | null | undefined;
    if (!geo) return null;
    if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return null;
    return geo;
}

function locationAddressSummary(location: ApiLocation): string {
    const address = locationFields(location).address as
        | AddressFields
        | null
        | undefined;
    if (!address) return '';
    return [address.city, address.region, address.countryCode]
        .filter(Boolean)
        .join(', ');
}

function locationFields(location: ApiLocation): Record<string, unknown> {
    return location.kindFields as Record<string, unknown>;
}
