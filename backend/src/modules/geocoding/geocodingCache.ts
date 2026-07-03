// Redis KV cache for geocoder responses. Cross-tenant (reference data).

import {tuning} from '../../config/tuning';
import type {GeocodeCandidate} from '../../types/api/location';
import * as Observability from '../Observability';
import {kv} from '../redis/services';
import {logger} from './logger';

const CACHE_PREFIX = 'geo:autocomplete';
const NEGATIVE_SENTINEL = '__NEG__';

export interface CacheKeyParts {
    query: string;
    biasCountryCode?: string | null;
    limit: number;
}

// Single source of truth so logically-equal queries hit the same entry.
export function normalizeQuery(s: string): string {
    return s
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

export function buildCacheKey(parts: CacheKeyParts): string {
    const bias = parts.biasCountryCode?.toUpperCase() ?? '_';
    return `${CACHE_PREFIX}:${bias}:${parts.limit}:${normalizeQuery(parts.query)}`;
}

export type CacheRead =
    | {kind: 'miss'}
    | {kind: 'negative'}
    | {kind: 'hit'; candidates: GeocodeCandidate[]};

export async function readCache(key: string): Promise<CacheRead> {
    const raw = await readCacheRaw(key);
    if (raw === null) {
        recordCacheMetric('miss');
        return {kind: 'miss'};
    }
    if (raw === NEGATIVE_SENTINEL) {
        recordCacheMetric('negative');
        return {kind: 'negative'};
    }
    const parsed = parseCachedCandidates(raw);
    if (parsed === null) {
        // Corrupted entry — log + treat as miss; next write replaces it.
        logger.warn('cache entry was not parseable; treating as miss');
        recordCacheMetric('miss');
        return {kind: 'miss'};
    }
    recordCacheMetric('hit');
    return {kind: 'hit', candidates: parsed};
}

async function readCacheRaw(key: string): Promise<string | null> {
    try {
        return await kv.get(key);
    } catch (err) {
        logger.warn('cache read failed: %s', err);
        return null;
    }
}

function parseCachedCandidates(raw: string): GeocodeCandidate[] | null {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as GeocodeCandidate[]) : null;
    } catch (err) {
        // Corrupt cached row — log + count so ops sees recurring poison keys.
        Observability.incrementCounter('geo_cache_parse_errors');
        logger.debug('cache parse failed: %s', err);
        return null;
    }
}

function recordCacheMetric(result: 'hit' | 'miss' | 'negative'): void {
    Observability.incrementLabeledCounter('geo_cache_hits_total', {result});
}

export async function writePositive(
    key: string,
    candidates: GeocodeCandidate[]
): Promise<void> {
    await writeCache(
        key,
        JSON.stringify(candidates),
        tuning.geocoding.cachePositiveTtlSec
    );
}

export async function writeNegative(key: string): Promise<void> {
    await writeCache(
        key,
        NEGATIVE_SENTINEL,
        tuning.geocoding.cacheNegativeTtlSec
    );
}

async function writeCache(
    key: string,
    value: string,
    ttlSec: number
): Promise<void> {
    try {
        await kv.set(key, value, ttlSec);
    } catch (err) {
        logger.warn('cache write failed: %s', err);
    }
}
