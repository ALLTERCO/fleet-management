import {Counter, Gauge, Histogram} from 'prom-client';
import type {FireBatchObserver} from '../alert/fireBatchWriter';
import {registry} from './registry';

// The alert fire writer: how many fires each transaction carries, how long it
// takes, how long fires wait for it, and how often a batch had to be split.

interface FireQueueSource {
    depth(): number;
    flushesInFlight(): number;
}

let watched: FireQueueSource | undefined;

const batchRows = new Histogram({
    name: 'fm_alert_fire_batch_rows',
    help: 'Alert fires in one batch transaction attempt',
    buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500],
    registers: [registry]
});

const batchSeconds = new Histogram({
    name: 'fm_alert_fire_batch_flush_seconds',
    help: 'Time one alert fire batch transaction took, connection wait included',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry]
});

const batches = new Counter({
    name: 'fm_alert_fire_batch_flushes_total',
    help: 'Alert fire batch transactions by outcome',
    labelNames: ['outcome'] as const,
    registers: [registry]
});

const splits = new Counter({
    name: 'fm_alert_fire_batch_split_retries_total',
    help: 'Failed alert fire batches retried as two halves',
    registers: [registry]
});

const queueWait = new Histogram({
    name: 'fm_alert_fire_queue_wait_seconds',
    help: 'Time an alert fire waited in the writer queue before its batch started',
    buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5, 10],
    registers: [registry]
});

new Gauge({
    name: 'fm_alert_fire_queue_depth',
    help: 'Alert fires waiting in the writer queue',
    registers: [registry],
    collect() {
        this.set(watched?.depth() ?? 0);
    }
});

new Gauge({
    name: 'fm_alert_fire_flushes_in_flight',
    help: 'Alert fire batch transactions running now',
    registers: [registry],
    collect() {
        this.set(watched?.flushesInFlight() ?? 0);
    }
});

export function watchAlertFireQueue(source: FireQueueSource): void {
    watched = source;
}

export const alertFireMetrics: FireBatchObserver = {
    batchFinished(rows, seconds, outcome) {
        batchRows.observe(rows);
        batchSeconds.observe(seconds);
        batches.inc({outcome});
    },
    splitRetried() {
        splits.inc();
    },
    waited(seconds) {
        queueWait.observe(seconds);
    }
};
