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
import {
    summarizeWsClientHealth,
    type WsClientHealthSample,
    type WsClientHealthStats
} from './wsClientHealthSummary';

const RING_SIZE = 100;

// Scrape-time gauge so Grafana can chart struggling clients against the
// connected-client count and spot the concurrent-load breaking point.
liveGauge(
    'fm_ws_struggling_clients',
    'Distinct browser WS clients with backpressure in the last 5 minutes',
    () => getWsClientHealthStats().strugglingClients
);

export interface StrugglingClient extends WsClientHealthSample {}
export type {WsClientHealthStats} from './wsClientHealthSummary';

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

// Compact five-minute summary for the in-app monitor. The ring is historical;
// old entries must not keep a client looking unhealthy after backpressure ends.
export function getWsClientHealthStats(): WsClientHealthStats {
    return summarizeWsClientHealth(strugglers);
}

export function resetWsClientHealth(): void {
    strugglers.length = 0;
}
