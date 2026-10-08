// A saved device row that never reaches the collector is a device the fleet
// has lost, so keep the reason in memory: a bare counter says how many broke,
// not which row or why, and the reconcile needs the row version to know
// whether retrying it can produce a different result.

import {BoundedMap} from '../boundedMap';
import * as Observability from '../Observability';

export interface DeviceLoadFailure {
    rowId: number;
    externalId: string;
    updatedMs: number;
    errorName: string;
    message: string;
    stack?: string;
    failedAtMs: number;
}

export interface DeviceLoadCounts {
    rows: number;
    registered: number;
    gap: number;
}

// Small on purpose: this is a diagnostic tail, not a queue.
const MAX_FAILURES = 100;

const failures = new BoundedMap<string, DeviceLoadFailure>({
    maxSize: MAX_FAILURES
});

let counts: DeviceLoadCounts = {rows: 0, registered: 0, gap: 0};

/** Record one load pass and publish its three gauges. */
export function recordRun(run: DeviceLoadCounts): void {
    counts = run;
    Observability.setGauge('device_load_rows', run.rows);
    Observability.setGauge('device_load_registered', run.registered);
    Observability.setGauge('device_load_gap', run.gap);
}

export function getCounts(): DeviceLoadCounts {
    return counts;
}

/** Newest failure wins: the latest reason is the one worth acting on. */
export function recordFailure(failure: DeviceLoadFailure): void {
    failures.set(failure.externalId, failure);
}

export function getFailure(externalId: string): DeviceLoadFailure | undefined {
    return failures.get(externalId);
}

export function clearFailure(externalId: string): void {
    failures.delete(externalId);
}

export function listFailures(): DeviceLoadFailure[] {
    return Array.from(failures.values());
}

/** A row deleted from the store is no longer a gap, so its entry goes too. */
export function pruneFailuresNotIn(presentExternalIds: Set<string>): void {
    for (const externalId of Array.from(failures.keys())) {
        if (!presentExternalIds.has(externalId)) failures.delete(externalId);
    }
}

Observability.registerModule('deviceLoad', {
    stats: () => ({
        rows: counts.rows,
        registered: counts.registered,
        gap: counts.gap,
        failed: failures.size,
        failedIds: Array.from(failures.keys()).join(',')
    }),
    topology: {
        role: 'source',
        cluster: 'ingest',
        zone: 'device_admission',
        downstreams: ['devices'],
        label: 'Device Load',
        description: 'Saved device rows registered into memory',
        route: '/monitoring/device-ingest'
    }
});
