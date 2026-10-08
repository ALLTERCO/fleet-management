// A short-lived copy of the deployed flows, read through Node-RED's admin API.
// Device pages ask "which flows use this device" often; Node-RED is asked at
// most once per cache window. A failed read is cached too, so a down Node-RED
// costs one warning per window instead of one per page view.

import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {type FlowRecord, fetchNodeRedFlows} from './flowClient';

const logger = log4js.getLogger('node-red-flow-cache');

export interface CachedFlows {
    /** False when Node-RED could not be read; records is then empty. */
    ok: boolean;
    records: FlowRecord[];
}

interface CacheEntry {
    value: CachedFlows;
    expiresAt: number;
}

type FlowFetcher = () => Promise<{flows: FlowRecord[]}>;

let entry: CacheEntry | null = null;
let inflight: Promise<CachedFlows> | null = null;
let fetcher: FlowFetcher = fetchNodeRedFlows;

function unreadable(error: unknown): CachedFlows {
    logger.warn(
        'Could not read Node-RED flows; device automation links are hidden until it answers: %s',
        error
    );
    return {ok: false, records: []};
}

function readFresh(): Promise<CachedFlows> {
    return fetcher().then(
        (payload) => ({ok: true, records: payload.flows}),
        unreadable
    );
}

async function refresh(): Promise<CachedFlows> {
    const value = await readFresh();
    entry = {value, expiresAt: Date.now() + tuning.nodeRed.flowCacheMs};
    return value;
}

/** Deployed flow records, at most `flowCacheMs` old. Never throws. */
export function readCachedFlows(): Promise<CachedFlows> {
    if (entry && entry.expiresAt > Date.now()) {
        return Promise.resolve(entry.value);
    }
    inflight ??= refresh().finally(() => {
        inflight = null;
    });
    return inflight;
}

/** Test seam: swap the admin-API reader and forget the cached copy. */
export function _setFlowFetcherForTest(next: FlowFetcher | null): void {
    fetcher = next ?? fetchNodeRedFlows;
    entry = null;
    inflight = null;
}
