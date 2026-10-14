#!/usr/bin/env node
import assert from 'node:assert/strict';
import {assessEmSyncHealth} from '../src/helpers/monitoringEmSyncHealth.ts';

const base = {
    emSyncStreamDepth: 1_000_000,
    emSyncStreamOldestAgeMs: 60 * 24 * 3600 * 1000,
    emSyncStreamPending: 0,
    emSyncLastWriteMs: 58,
    emSyncLastRpcFetchMs: 550,
    emSyncWorstChannelLagSec: 1002,
    emActiveSyncs: 0,
    emQueueSize: 1
};

const assess = (changes = {}) => assessEmSyncHealth({...base, ...changes});

assert.equal(
    assess(),
    'healthy',
    'old acknowledged Redis entries are retained history, not backlog'
);
assert.equal(
    assess({
        emSyncStreamDepth: 2_000_000,
        emSyncStreamOldestAgeMs: 365 * 24 * 3600 * 1000
    }),
    'healthy',
    'retention size and age alone must not degrade health'
);
assert.equal(
    assess({
        emSyncStreamPending: 1000,
        emSyncLastWriteMs: 1500,
        emSyncLastRpcFetchMs: 3000,
        emSyncWorstChannelLagSec: 3600,
        emActiveSyncs: 30,
        emQueueSize: 200
    }),
    'healthy',
    'warning thresholds stay strict and do not trigger at equality'
);
assert.equal(assess({emSyncStreamPending: 1001}), 'warning');
assert.equal(assess({emSyncStreamPending: 10001}), 'critical');
assert.equal(assess({emSyncLastWriteMs: 1501}), 'warning');
assert.equal(assess({emSyncLastWriteMs: 5001}), 'critical');
assert.equal(assess({emSyncLastRpcFetchMs: 3001}), 'warning');
assert.equal(assess({emSyncLastRpcFetchMs: 10001}), 'critical');
assert.equal(assess({emSyncWorstChannelLagSec: 3601}), 'warning');
assert.equal(assess({emSyncWorstChannelLagSec: 21601}), 'critical');
assert.equal(
    assess({emActiveSyncs: 31, emQueueSize: 201}),
    'warning',
    'active synchronization pressure still warns'
);
assert.equal(
    assess({emActiveSyncs: 40, emQueueSize: 200}),
    'warning',
    'critical active pressure requires queue backlog above 200'
);
assert.equal(
    assess({emActiveSyncs: 40, emQueueSize: 201}),
    'critical',
    'active synchronization plus queue backlog still escalates'
);

console.log('EM sync health regressions PASS (14 assertions)');
