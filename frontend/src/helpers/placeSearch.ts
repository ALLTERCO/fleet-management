import {sendRPC} from '@/tools/websocket';

export type PlaceKind = 'country' | 'admin' | 'city' | 'street';
export type PlaceSource = 'local' | 'cache' | 'nominatim' | 'local-weak';

export interface PlaceCandidate {
    kind: PlaceKind;
    geonameid?: number;
    name: string;
    asciiname?: string;
    countryCode: string;
    countryName?: string;
    adminCode?: string;
    adminName?: string;
    // Street-level parts (present on Nominatim hits with a house number/road).
    city?: string;
    streetName?: string;
    houseNumber?: string;
    postalCode?: string;
    lat: number;
    lng: number;
    timezone?: string;
    weight: number;
    score: number;
}

export interface PlaceCountry {
    iso2: string;
    iso3: string;
    name: string;
    continent: string;
    capital?: string;
    lat?: number;
    lng?: number;
}

export interface SearchPlacesResult {
    candidates: PlaceCandidate[];
    source: PlaceSource;
}

export interface SearchPlacesParams {
    query: string;
    biasCountryCode?: string | null;
    limit?: number;
    precision?: 'place' | 'street';
}

export async function searchPlaces(
    params: SearchPlacesParams
): Promise<SearchPlacesResult> {
    const payload: Record<string, unknown> = {query: params.query};
    if (params.biasCountryCode)
        payload.biasCountryCode = params.biasCountryCode;
    if (params.limit !== undefined) payload.limit = params.limit;
    if (params.precision) payload.precision = params.precision;
    return sendRPC<SearchPlacesResult>(
        'FLEET_MANAGER',
        'Location.SearchPlaces',
        payload
    );
}

export async function listCountries(): Promise<PlaceCountry[]> {
    const res = await sendRPC<{countries: PlaceCountry[]}>(
        'FLEET_MANAGER',
        'Location.ListCountries',
        {}
    );
    return res.countries ?? [];
}

export interface PlaceRegion {
    code: string;
    countryCode: string;
    name: string;
    lat: number;
    lng: number;
}

export async function listRegions(countryCode: string): Promise<PlaceRegion[]> {
    const res = await sendRPC<{regions: PlaceRegion[]}>(
        'FLEET_MANAGER',
        'Location.ListRegions',
        {countryCode}
    );
    return res.regions ?? [];
}
