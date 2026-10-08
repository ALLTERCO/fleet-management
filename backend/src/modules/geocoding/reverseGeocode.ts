import type {GeocodeCandidate} from '../../types/api/location';
import {
    buildCacheKey,
    readCache,
    writeNegative,
    writePositive
} from './geocodingCache';
import {reverseGeocodeNominatim} from './nominatim';
import {tryAcquireNominatimSlot} from './nominatimGate';

export interface ReverseGeocodeRequest {
    lat: number;
    lng: number;
    language?: string;
}

export interface ReverseGeocodeResult {
    candidate: GeocodeCandidate | null;
    source: 'cache' | 'nominatim' | 'unavailable';
}

function coordinateCacheKey(request: ReverseGeocodeRequest): string {
    const language = request.language?.trim().toLowerCase() || '_';
    return buildCacheKey({
        query: `reverse:${request.lat.toFixed(5)},${request.lng.toFixed(5)}:${language}`,
        limit: 1
    });
}

export async function reverseGeocode(
    request: ReverseGeocodeRequest
): Promise<ReverseGeocodeResult> {
    const key = coordinateCacheKey(request);
    const cached = await readCache(key);
    if (cached.kind === 'hit') {
        return {candidate: cached.candidates[0] ?? null, source: 'cache'};
    }
    if (cached.kind === 'negative') {
        return {candidate: null, source: 'unavailable'};
    }
    if (!(await tryAcquireNominatimSlot())) {
        return {candidate: null, source: 'unavailable'};
    }
    const candidate = await reverseGeocodeNominatim(
        request.lat,
        request.lng,
        request.language
    );
    if (!candidate) {
        await writeNegative(key);
        return {candidate: null, source: 'unavailable'};
    }
    await writePositive(key, [candidate]);
    return {candidate, source: 'nominatim'};
}
