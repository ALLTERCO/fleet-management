// Top-level orchestration: local-first, then cache, then Nominatim.
// Reads top-down. Each branch is a focused function.

import type {GeocodeCandidate, GeocodeSource} from '../../types/api/location';
import * as Observability from '../Observability';
import {LOCAL_CONFIDENCE_MIN, searchPlacesLocal} from './geocoding';
import {
    buildCacheKey,
    readCache,
    writeNegative,
    writePositive
} from './geocodingCache';
import {searchPlacesNominatim} from './nominatim';
import {tryAcquireNominatimSlot} from './nominatimGate';

export interface SearchPlacesRequest {
    query: string;
    biasCountryCode?: string | null;
    limit?: number;
    // 'street' goes straight to the street geocoder (skips the local city-only
    // shortcut) so a full address always resolves to its exact point.
    precision?: 'place' | 'street';
}

export interface SearchPlacesResult {
    candidates: GeocodeCandidate[];
    source: GeocodeSource;
}

export async function searchPlaces(
    req: SearchPlacesRequest
): Promise<SearchPlacesResult> {
    const local = await searchPlacesLocal(req);
    // The local index is city-only; street precision must reach Nominatim.
    if (req.precision !== 'street' && localHitIsStrong(local)) {
        return recordResult(local, 'local');
    }
    return await searchPlacesOnlineWithFallback(req, local);
}

function localHitIsStrong(local: GeocodeCandidate[]): boolean {
    return local.length > 0 && local[0].score >= LOCAL_CONFIDENCE_MIN;
}

async function searchPlacesOnlineWithFallback(
    req: SearchPlacesRequest,
    weakLocal: GeocodeCandidate[]
): Promise<SearchPlacesResult> {
    const limit = req.limit ?? 5;
    const cacheKey = buildCacheKey({
        query: req.query,
        biasCountryCode: req.biasCountryCode ?? null,
        limit
    });
    const cached = await readCache(cacheKey);
    if (cached.kind === 'hit') return recordResult(cached.candidates, 'cache');
    if (cached.kind === 'negative')
        return recordResult(weakLocal, 'local-weak');
    return await callNominatimOrFallback(req, weakLocal, cacheKey);
}

async function callNominatimOrFallback(
    req: SearchPlacesRequest,
    weakLocal: GeocodeCandidate[],
    cacheKey: string
): Promise<SearchPlacesResult> {
    const slotAcquired = await tryAcquireNominatimSlot();
    if (!slotAcquired) return recordResult(weakLocal, 'local-weak');
    const remote = await searchPlacesNominatim({
        query: req.query,
        biasCountryCode: req.biasCountryCode ?? null,
        limit: req.limit ?? 5
    });
    if (remote.length === 0) {
        await writeNegative(cacheKey);
        return recordResult(weakLocal, 'local-weak');
    }
    await writePositive(cacheKey, remote);
    return recordResult(remote, 'nominatim');
}

function recordResult(
    candidates: GeocodeCandidate[],
    source: GeocodeSource
): SearchPlacesResult {
    Observability.incrementLabeledCounter('geo_search_total', {result: source});
    return {candidates, source};
}
