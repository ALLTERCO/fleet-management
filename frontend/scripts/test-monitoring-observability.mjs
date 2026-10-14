#!/usr/bin/env node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
    formatBackendObservabilityLevel,
    parseBackendObservabilityLevel,
    sendAuthorizedBackendObservabilityLevel
} from '../src/helpers/monitoringObservability.ts';

const labels = ['OFF', 'Light', 'Medium', 'Full'];

test('backend collection is displayed independently of browser-local level', () => {
    assert.equal(formatBackendObservabilityLevel(2, labels), 'Medium');
    assert.equal(formatBackendObservabilityLevel(0, labels), 'OFF');
    assert.equal(formatBackendObservabilityLevel(3, labels), 'Full');
    assert.equal(parseBackendObservabilityLevel(2), 2);
});

test('missing and malformed health metrics cannot impersonate a valid level', () => {
    for (const value of [null, undefined, -1, 4, NaN, Infinity, 1.1, '2', true]) {
        assert.equal(formatBackendObservabilityLevel(value, labels), 'not available');
        assert.equal(parseBackendObservabilityLevel(value), null);
    }
});

test('backend controls enforce the protected RPC permission and browser tier is independent', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../src/pages/settings/monitoring/control-panel.vue', import.meta.url)),
        'utf8'
    );
    assert.match(source, /rpc\.canCall\('System\.Observability\.Set'\)/);
    assert.match(source, /:disabled="!canSetObservability"/);
    assert.match(source, /Backend collection \(actual\): \{\{ backendObservabilityLabel \}\}/);
    assert.match(source, /Browser telemetry \(this browser\): \{\{ OBS_LEVEL_LABELS\[store\.obsLevel\] \}\}/);
    assert.match(source, /:class="backendObservabilityLevel === i \? levelActiveClass\(i\)/);
    assert.match(source, /:aria-pressed="backendObservabilityLevel === i"/);
    assert.match(source, /role="group" aria-label="Backend observability level"/);
    assert.match(source, /role="group" aria-label="Browser telemetry level"/);
    assert.match(source, /@click="store\.setBackendObservabilityLevel\(i as ObsLevel\)"/);
    assert.match(source, /@click="store\.setBrowserObservabilityLevel\(i as ObsLevel\)"/);
    assert.match(source, /Current backend level/);
    assert.match(source, /Current browser level/);
});

test('a denied backend-level change never sends a protected RPC', async () => {
    const sent = [];
    const changed = await sendAuthorizedBackendObservabilityLevel(
        3,
        () => false,
        async (level) => { sent.push(level); }
    );
    assert.equal(changed, false);
    assert.deepEqual(sent, []);
});

test('an authorized backend-level change calls the RPC exactly once', async () => {
    const sent = [];
    const changed = await sendAuthorizedBackendObservabilityLevel(
        3,
        () => true,
        async (level) => { sent.push(level); }
    );
    assert.equal(changed, true);
    assert.deepEqual(sent, [3]);
});

test('a rejected backend RPC propagates failure and cannot report success', async () => {
    await assert.rejects(
        sendAuthorizedBackendObservabilityLevel(2, () => true, async () => {
            throw new Error('denied');
        }),
        /denied/
    );
});

test('monitoring store and all empty-state actions keep browser and server controls separate', () => {
    const read = (relative) => readFileSync(
        fileURLToPath(new URL(`../src/${relative}`, import.meta.url)),
        'utf8'
    );
    const store = read('stores/monitoring.ts');
    assert.match(store, /function setBrowserObservabilityLevel\(l: ObsLevel\)/);
    assert.match(store, /function setBackendObservabilityLevel\(l: ObsLevel\)/);
    assert.match(store, /rpcPermissions\.canCall\('System\.Observability\.Set'\)/);
    assert.doesNotMatch(store, /function changeLevel\(/);
    const paths = [
        'overview', 'activity', 'commands', 'database',
        'device-ingest', 'services', 'events', 'host'
    ];
    for (const page of paths) {
        const source = read(`pages/settings/monitoring/${page}.vue`);
        assert.match(source, /store\.setBrowserObservabilityLevel\([12]\)/, page);
        assert.doesNotMatch(source, /store\.changeLevel\(/, page);
    }
    const healthStrip = read('components/monitoring/MonitoringHealthStrip.vue');
    assert.match(healthStrip, /Backend \{\{ backendObservabilityLabel \}\}/);
    assert.match(healthStrip, /Browser \{\{ OBS_LEVEL_LABELS\[obsLevel\] \}\}/);
    assert.match(healthStrip, /parseBackendObservabilityLevel\(monitoring\.latestMetrics\?\.level/);
});
