import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    summarizeWsClientHealth,
    WS_CLIENT_HEALTH_WINDOW_SEC
} from '../src/modules/observability/wsClientHealthSummary.ts';

const NOW = 2_000_000_000_000;
const FIVE_MINUTES_MS = WS_CLIENT_HEALTH_WINDOW_SEC * 1000;

test('history older than five minutes does not keep clients struggling', () => {
    const summary = summarizeWsClientHealth(
        [
            {
                clientId: 'old-paused',
                bufferedBytes: 32_000_000,
                action: 'paused',
                ts: NOW - FIVE_MINUTES_MS - 1
            },
            {
                clientId: 'old-dropped',
                bufferedBytes: 48_000_000,
                action: 'dropped',
                ts: NOW - FIVE_MINUTES_MS - 10_000
            }
        ],
        NOW
    );

    assert.deepEqual(summary, {
        windowSec: 300,
        strugglingClients: 0,
        pausedClients: 0,
        droppedClients: 0,
        worstBufferedBytes: 0
    });
});

test('recent paused backpressure is retained without claiming dropped events', () => {
    const summary = summarizeWsClientHealth(
        [
            {
                clientId: 'paused-client',
                bufferedBytes: 4096,
                action: 'paused',
                ts: NOW - 30_000
            }
        ],
        NOW
    );

    assert.equal(summary.strugglingClients, 1);
    assert.equal(summary.pausedClients, 1);
    assert.equal(summary.droppedClients, 0);
    assert.equal(summary.worstBufferedBytes, 4096);
});

test('recent dropped backpressure stays distinguishable from paused backpressure', () => {
    const summary = summarizeWsClientHealth(
        [
            {
                clientId: 'paused-client',
                bufferedBytes: 2048,
                action: 'paused',
                ts: NOW - 20_000
            },
            {
                clientId: 'dropped-client',
                bufferedBytes: 8192,
                action: 'dropped',
                ts: NOW - 10_000
            }
        ],
        NOW
    );

    assert.equal(summary.strugglingClients, 2);
    assert.equal(summary.pausedClients, 1);
    assert.equal(summary.droppedClients, 1);
    assert.equal(summary.worstBufferedBytes, 8192);
});

test('no backpressure history is healthy and empty', () => {
    assert.deepEqual(summarizeWsClientHealth([], NOW), {
        windowSec: 300,
        strugglingClients: 0,
        pausedClients: 0,
        droppedClients: 0,
        worstBufferedBytes: 0
    });
});
