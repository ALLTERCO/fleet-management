// ElectricityMaps adapter. Returns [] on any failure — caller substitutes
// the static fallback. Schema: https://static.electricitymaps.com/api/docs/

import {getLogger} from 'log4js';
import * as Observability from '../../modules/Observability';
import type {
    HourlyCarbonPoint,
    HourlyCarbonProvider,
    HourlyCarbonQuery
} from './hourlyCarbonProvider';

const logger = getLogger('electricityMaps');

interface RawIntensityEntry {
    datetime?: string;
    carbonIntensity?: number;
}

interface RawIntensityResponse {
    history?: RawIntensityEntry[];
}

export interface ElectricityMapsConfig {
    readonly apiKey: string;
    readonly url: string;
    readonly timeoutMs: number;
}

export function buildElectricityMapsProvider(
    config: ElectricityMapsConfig
): HourlyCarbonProvider {
    return {
        source: 'electricitymaps',
        fetchHourly(query) {
            return fetchHistoryFor(query, config);
        }
    };
}

async function fetchHistoryFor(
    query: HourlyCarbonQuery,
    config: ElectricityMapsConfig
): Promise<HourlyCarbonPoint[]> {
    const url = buildHistoryUrl(query, config.url);
    const raw = await fetchWithTimeout(url, config);
    if (raw === null) return [];
    return parseHistory(raw, query);
}

function buildHistoryUrl(query: HourlyCarbonQuery, baseUrl: string): string {
    const params = new URLSearchParams({zone: query.zoneCode});
    return `${baseUrl}/carbon-intensity/history?${params.toString()}`;
}

async function fetchWithTimeout(
    url: string,
    config: ElectricityMapsConfig
): Promise<RawIntensityResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {'auth-token': config.apiKey}
        });
        return await handleResponse(res);
    } catch (err) {
        recordFailure(err, url);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function handleResponse(
    res: Response
): Promise<RawIntensityResponse | null> {
    const outcome = outcomeFromStatus(res.status, res.ok);
    Observability.incrementLabeledCounter(
        'carbon_electricitymaps_calls_total',
        {
            outcome
        }
    );
    if (outcome !== 'success') return null;
    const body = (await res.json()) as RawIntensityResponse;
    return body && typeof body === 'object' ? body : null;
}

function outcomeFromStatus(
    status: number,
    ok: boolean
): 'success' | 'rate_limited' | 'unauthorized' | 'error' {
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'unauthorized';
    return ok ? 'success' : 'error';
}

function recordFailure(err: unknown, url: string): void {
    const outcome =
        err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error';
    Observability.incrementLabeledCounter(
        'carbon_electricitymaps_calls_total',
        {
            outcome
        }
    );
    logger.warn('electricitymaps call failed url=%s: %s', url, err);
}

function parseHistory(
    raw: RawIntensityResponse,
    query: HourlyCarbonQuery
): HourlyCarbonPoint[] {
    if (!Array.isArray(raw.history)) return [];
    const startMs = Date.parse(query.start);
    const endMs = Date.parse(query.end);
    const within = (ms: number) =>
        Number.isFinite(startMs) && Number.isFinite(endMs)
            ? ms >= startMs && ms < endMs
            : true;
    const out: HourlyCarbonPoint[] = [];
    for (const entry of raw.history) {
        const point = parseEntry(entry);
        if (point !== null && within(Date.parse(point.hour))) out.push(point);
    }
    return out;
}

function parseEntry(entry: RawIntensityEntry): HourlyCarbonPoint | null {
    if (typeof entry.datetime !== 'string') return null;
    if (typeof entry.carbonIntensity !== 'number') return null;
    if (!Number.isFinite(entry.carbonIntensity)) return null;
    return {hour: entry.datetime, gPerKWh: entry.carbonIntensity};
}
