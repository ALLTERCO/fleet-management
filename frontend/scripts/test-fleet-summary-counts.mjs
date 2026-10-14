import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {formatDeviceCount, formatGroupCount} from '../src/helpers/fleetSummaryCounts.ts';

test('group count labels are accurate for zero, one, and multiple groups', () => {
    assert.equal(formatGroupCount(0), '0 groups');
    assert.equal(formatGroupCount(1), '1 group');
    assert.equal(formatGroupCount(5), '5 groups');
});

test('device breakdown uses singular when exactly one device exists', () => {
    assert.equal(formatDeviceCount(0), '0 devices');
    assert.equal(formatDeviceCount(1), '1 device');
    assert.equal(formatDeviceCount(38), '38 devices');
});

test('fleet summary displays the groups unit and uses count helpers', () => {
    const view = readFileSync(new URL('../src/components/dashboard/DashFleetSummary.vue', import.meta.url), 'utf8');
    assert.match(view, /class="dfs-label">Groups<\/span>/);
    assert.match(view, /formatGroupCount\(groups\)/);
    assert.match(view, /formatDeviceCount\(count\)/);
    assert.doesNotMatch(view, /class="dfs-label">Locations<\/span>/);
});
