import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {wsBackpressureStatus} from '../src/helpers/wsBackpressureHealth.ts';

test('no recent backpressure is healthy', () => {
    assert.equal(
        wsBackpressureStatus({pausedClients: 0, droppedClients: 0}),
        'healthy'
    );
});

test('recent paused clients warn without claiming an active slow client', () => {
    assert.equal(
        wsBackpressureStatus({pausedClients: 2, droppedClients: 0}),
        'warning'
    );
});

test('recent dropped events remain critical', () => {
    assert.equal(
        wsBackpressureStatus({pausedClients: 1, droppedClients: 1}),
        'critical'
    );
});

test('concurrent-load UI labels the five-minute window and uses split severity', () => {
    const panel = readFileSync(
        new URL('../src/components/monitoring/ConcurrentLoadPanel.vue', import.meta.url),
        'utf8'
    );
    const store = readFileSync(
        new URL('../src/stores/monitoring.ts', import.meta.url),
        'utf8'
    );

    assert.match(panel, /label="Backpressured \(5m\)"/);
    assert.match(panel, /label="Worst Buffer \(5m\)"/);
    assert.match(panel, /:warn="latest\.wsPausedClients > 0"/);
    assert.match(panel, /:critical="latest\.wsDroppedClients > 0"/);
    assert.doesNotMatch(panel, /wsStrugglingClients > 0 \|\|/);
    assert.match(store, /pausedClients \?\? 0/);
    assert.match(store, /droppedClients \?\? 0/);
});
