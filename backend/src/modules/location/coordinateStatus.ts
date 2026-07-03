import type {LocationCoordinateStatus} from '../../types/api/location';

interface GeoFields {
    lat: number;
    lng: number;
}

interface AddressFields {
    city?: string;
    region?: string;
    countryCode?: string;
}

export function locationCoordinateStatus(
    fields: Record<string, unknown>
): LocationCoordinateStatus {
    const geo = fields.geo as GeoFields | null | undefined;
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        return {state: 'mapped', summary: `${geo.lat}, ${geo.lng}`};
    }

    const summary = locationAddressSummary(fields);
    if (summary) return {state: 'address_only', summary};

    return {state: 'missing_address', summary: ''};
}

function locationAddressSummary(fields: Record<string, unknown>): string {
    const address = fields.address as AddressFields | null | undefined;
    if (!address) return '';
    return [address.city, address.region, address.countryCode]
        .filter(Boolean)
        .join(', ');
}
