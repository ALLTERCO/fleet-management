// Public Nominatim adapter. Returns [] on any failure.

import {tuning} from '../../config/tuning';
import type {GeocodeCandidate} from '../../types/api/location';
import * as Observability from '../Observability';
import {logger} from './logger';

export interface NominatimQuery {
    query: string;
    biasCountryCode?: string | null;
    limit?: number;
}

export async function searchPlacesNominatim(
    q: NominatimQuery
): Promise<GeocodeCandidate[]> {
    const url = buildNominatimUrl(q);
    const response = await fetchWithTimeout(
        url,
        tuning.geocoding.nominatimTimeoutMs
    );
    if (response === null) return [];
    return parseNominatimResponse(response);
}

function buildNominatimUrl(q: NominatimQuery): string {
    const params = new URLSearchParams({
        q: q.query,
        format: 'jsonv2',
        limit: String(q.limit ?? 5),
        addressdetails: '1'
    });
    if (q.biasCountryCode) {
        params.set('countrycodes', q.biasCountryCode.toLowerCase());
    }
    return `${tuning.geocoding.nominatimUrl}/search?${params.toString()}`;
}

async function fetchWithTimeout(
    url: string,
    timeoutMs: number
): Promise<unknown[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {'User-Agent': tuning.geocoding.nominatimUserAgent}
        });
        return await handleNominatimResponse(res);
    } catch (err) {
        recordNominatimFailure(err, url);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function handleNominatimResponse(
    res: Response
): Promise<unknown[] | null> {
    if (res.status === 429) {
        Observability.incrementLabeledCounter('geo_nominatim_calls_total', {
            outcome: 'rate_limited'
        });
        return null;
    }
    if (!res.ok) {
        Observability.incrementLabeledCounter('geo_nominatim_calls_total', {
            outcome: 'error'
        });
        return null;
    }
    Observability.incrementLabeledCounter('geo_nominatim_calls_total', {
        outcome: 'success'
    });
    const body = await res.json();
    return Array.isArray(body) ? body : null;
}

function recordNominatimFailure(err: unknown, url: string): void {
    const outcome =
        err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error';
    Observability.incrementLabeledCounter('geo_nominatim_calls_total', {
        outcome
    });
    logger.warn('nominatim call failed url=%s: %s', url, err);
}

export function parseNominatimResponse(raw: unknown[]): GeocodeCandidate[] {
    const out: GeocodeCandidate[] = [];
    for (const item of raw) {
        const candidate = parseNominatimEntry(item);
        if (candidate !== null) out.push(candidate);
    }
    return out;
}

interface RawNominatimEntry {
    osm_id?: number;
    place_id?: number;
    display_name?: string;
    name?: string;
    lat?: string;
    lon?: string;
    importance?: number;
    addresstype?: string;
    type?: string;
    address?: {
        country_code?: string;
        country?: string;
        state?: string;
        region?: string;
        city?: string;
        town?: string;
        village?: string;
        road?: string;
        house_number?: string;
        postcode?: string;
    };
}

function parseNominatimEntry(item: unknown): GeocodeCandidate | null {
    if (typeof item !== 'object' || item === null) return null;
    const e = item as RawNominatimEntry;
    const lat = parseCoord(e.lat);
    const lng = parseCoord(e.lon);
    if (lat === null || lng === null) return null;
    const countryCode = e.address?.country_code?.toUpperCase() ?? '';
    if (countryCode.length !== 2) return null;
    return {
        kind: classifyNominatimKind(e),
        name: e.name ?? e.display_name ?? 'unknown',
        countryCode,
        countryName: e.address?.country,
        adminName: e.address?.state ?? e.address?.region,
        city: e.address?.city ?? e.address?.town ?? e.address?.village,
        streetName: e.address?.road,
        houseNumber: e.address?.house_number,
        postalCode: e.address?.postcode,
        lat,
        lng,
        weight: Math.round((e.importance ?? 0) * 1_000_000),
        score: e.importance ?? 0.5
    };
}

function parseCoord(raw: string | undefined): number | null {
    if (typeof raw !== 'string') return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
}

function classifyNominatimKind(e: RawNominatimEntry): GeocodeCandidate['kind'] {
    const t = e.addresstype ?? e.type ?? '';
    if (t === 'country') return 'country';
    if (t === 'state' || t === 'region' || t === 'administrative')
        return 'admin';
    // A road, a building, or any result carrying a house number is street-level.
    if (
        t === 'road' ||
        t === 'house' ||
        t === 'building' ||
        e.address?.house_number
    )
        return 'street';
    return 'city';
}
