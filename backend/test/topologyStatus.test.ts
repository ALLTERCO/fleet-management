import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeModuleStatus} from '../src/modules/observability/topologyStatus';

const CANONICAL_STATUSES = [
    'healthy',
    'warning',
    'critical',
    'unknown'
] as const;

test('normalizes topology statuses to the public ModuleStatus contract', () => {
    assert.equal(normalizeModuleStatus(undefined), 'healthy');
    assert.equal(normalizeModuleStatus('ok'), 'healthy');

    for (const status of CANONICAL_STATUSES) {
        assert.equal(normalizeModuleStatus(status), status);
    }
});

test('degrades non-canonical module-local statuses to unknown', () => {
    for (const status of [
        'stale',
        'mismatch',
        'error',
        'running',
        '',
        null,
        1,
        true
    ]) {
        assert.equal(normalizeModuleStatus(status), 'unknown');
    }
});

test('canonical health buckets account for every normalized node', () => {
    const localStatuses = [
        undefined,
        'ok',
        'healthy',
        'warning',
        'critical',
        'unknown',
        'stale',
        'mismatch',
        'error'
    ];
    const buckets: Record<(typeof CANONICAL_STATUSES)[number], number> = {
        healthy: 0,
        warning: 0,
        critical: 0,
        unknown: 0
    };

    for (const localStatus of localStatuses) {
        buckets[normalizeModuleStatus(localStatus)] += 1;
    }

    assert.equal(
        Object.values(buckets).reduce((total, count) => total + count, 0),
        localStatuses.length
    );
    assert.deepEqual(buckets, {
        healthy: 3,
        warning: 1,
        critical: 1,
        unknown: 4
    });
});
