import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {countByStatus} from '../src/helpers/topologyStatusCounts.ts';

test('every canonical topology status contributes to the module total', () => {
    const nodes = [
        {status: 'healthy'},
        {status: 'warning'},
        {status: 'critical'},
        {status: 'unknown'}
    ];
    const counts = countByStatus(nodes);
    assert.deepEqual(counts, {healthy: 1, warning: 1, critical: 1, unknown: 1});
    assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), nodes.length);
});

test('unexpected module-local status cannot disappear from health buckets', () => {
    const nodes = [
        ...Array.from({length: 30}, () => ({status: 'healthy'})),
        ...Array.from({length: 4}, () => ({status: 'unknown'})),
        {status: 'ok'},
        {status: '__proto__'},
        {status: undefined}
    ];
    const counts = countByStatus(nodes);
    assert.deepEqual(counts, {healthy: 30, warning: 0, critical: 0, unknown: 7});
    assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), nodes.length);
});

test('healthy headline is scoped to monitored paths and names missing coverage', () => {
    const view = readFileSync(new URL('../src/components/monitoring/MonitoringHealthStrip.vue', import.meta.url), 'utf8');
    assert.match(view, /healthy: 'Monitored paths nominal'/);
    assert.doesNotMatch(view, /All systems nominal/);
    assert.match(view, /hasSnapshot && unknownModuleCount > 0/);
    assert.match(view, /unknownModuleCount === 1 \? 'module' : 'modules'/);
});
