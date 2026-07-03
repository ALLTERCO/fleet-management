// Monitoring for browser WebSocket clients under concurrent load. When a client
// can't keep up, its socket send-buffer grows past the pause threshold and the
// server either pauses (Redis path) or drops events (in-memory path) for it.
// That backpressure is the first thing that breaks as more browsers connect, so
// we count it and keep the recent strugglers — which client, how backed up.

import {incrementLabeledCounter} from './counters';
import {liveGauge} from './processMetrics';
import {getLevel} from './samplers';
import {pushRing} from './util/ringBuffer';
import {type WindowQuery, windowedTopN} from './util/windowedTopN';

const RING_SIZE = 100;

// Scrape-time gauge so Grafana can chart struggling clients against the
// connected-client count and spot the concurrent-load breaking point.
liveGauge(
    'fm_ws_struggling_clients',
    'Browser WS clients in the recent backpressure ring',
    () => getWsClientHealthStats().strugglingClients
);

export interface StrugglingClient {
    clientId: string;
    bufferedBytes: number;
    // 'paused' = events held back (durable Redis path); 'dropped' = events lost.
    action: 'paused' | 'dropped';
    ts: number;
}

export interface WsClientHealthStats {
    strugglingClients: number;
    worstBufferedBytes: number;
}

const strugglers: StrugglingClient[] = [];

// One client hit backpressure. Cheap (a gated labeled increment) so it is safe
// on the broadcast hot path even with thousands of connected browsers.
export function recordBackpressure(event: {
    clientId: string;
    bufferedBytes: number;
    action: 'paused' | 'dropped';
}): void {
    incrementLabeledCounter('ws_client_backpressure_total', {
        action: event.action
    });
    if (getLevel() < 2) return;
    pushRing(
        strugglers,
        {
            clientId: event.clientId,
            bufferedBytes: event.bufferedBytes,
            action: event.action,
            ts: Date.now()
        },
        RING_SIZE
    );
}

export function getStrugglingClients(): StrugglingClient[] {
    return [...strugglers];
}

// Worst-buffered-first within the window, for the in-app Slow Operations view.
export function queryStrugglingClients(query: WindowQuery): StrugglingClient[] {
    return windowedTopN(strugglers, query, (s) => s.bufferedBytes);
}

// Compact summary for the in-app monitor: how many distinct clients are
// struggling right now and the worst send-buffer seen.
export function getWsClientHealthStats(): WsClientHealthStats {
    const ids = new Set<string>();
    let worstBufferedBytes = 0;
    for (const s of strugglers) {
        ids.add(s.clientId);
        if (s.bufferedBytes > worstBufferedBytes) {
            worstBufferedBytes = s.bufferedBytes;
        }
    }
    return {strugglingClients: ids.size, worstBufferedBytes};
}

export function resetWsClientHealth(): void {
    strugglers.length = 0;
}
