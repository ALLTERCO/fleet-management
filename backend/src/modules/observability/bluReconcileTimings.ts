import {Counter, Gauge, Histogram} from 'prom-client';
import {registry} from './registry';
import {getLevel} from './samplers';

const reconcileRequests = new Counter({
    name: 'fm_blu_reconcile_requests_total',
    help: 'BLU gateway reconcile requests by single-flight disposition',
    labelNames: ['disposition'] as const,
    registers: [registry]
});

const reconcileRuns = new Counter({
    name: 'fm_blu_reconcile_runs_total',
    help: 'BLU gateway reconcile runs by outcome',
    labelNames: ['outcome'] as const,
    registers: [registry]
});

const reconcileDuration = new Histogram({
    name: 'fm_blu_reconcile_duration_seconds',
    help: 'BLU gateway reconcile wall duration in seconds',
    labelNames: ['outcome'] as const,
    buckets: [
        0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30
    ],
    registers: [registry]
});

const reconcileActive = new Gauge({
    name: 'fm_blu_reconcile_active',
    help: 'BLU gateway reconciles currently executing',
    registers: [registry]
});

const reconcileQueued = new Gauge({
    name: 'fm_blu_reconcile_queued',
    help: 'BLU gateway reconciles waiting for process capacity',
    registers: [registry]
});

const reconcileCapacityRejections = new Counter({
    name: 'fm_blu_reconcile_capacity_rejections_total',
    help: 'BLU gateway reconciles rejected because the bounded queue was full',
    registers: [registry]
});

export function recordBluReconcileRequest(coalesced: boolean): void {
    if (getLevel() < 2) return;
    reconcileRequests.inc({
        disposition: coalesced ? 'coalesced' : 'started'
    });
}

export function recordBluReconcileRun(
    outcome: 'succeeded' | 'failed',
    durationMs: number
): void {
    if (getLevel() < 2) return;
    reconcileRuns.inc({outcome});
    reconcileDuration.observe({outcome}, Math.max(0, durationMs) / 1000);
}

export function recordBluReconcileCapacity(
    active: number,
    queued: number
): void {
    if (getLevel() < 2) return;
    reconcileActive.set(Math.max(0, active));
    reconcileQueued.set(Math.max(0, queued));
}

export function recordBluReconcileCapacityRejection(): void {
    if (getLevel() < 2) return;
    reconcileCapacityRejections.inc();
}
