import {ALERT_STATES} from '../../types/api/alert';
import {incrementCounter, setGauge} from '../observability/counters';
import * as PostgresProvider from '../PostgresProvider';

export const OPEN_INSTANCE_BATCH_LIMIT = 32;

export interface OpenInstanceRow {
    fingerprint: string;
    id: number;
    state: string;
}

interface Request {
    fingerprint: string;
    queuedAt: number;
    resolve: (row: OpenInstanceRow | undefined) => void;
    reject: (error: unknown) => void;
}

interface BatchScope {
    organizationId: string;
    ruleId: number;
}

// 'immediate' waits for the event-loop turn to end, so reads from many events
// share one query; 'microtask' keeps one caller's burst together.
type FlushTiming = 'microtask' | 'immediate';

const activeBatches = new Set<OpenInstanceReadBatch>();
const sharedBatches = new Map<string, OpenInstanceReadBatch>();

export class AlertReadAbortedError extends Error {
    readonly code = 'ALERT_READ_ABORTED';
}

function refreshQueueMetrics(): void {
    let queued = 0;
    let oldest = Date.now();
    for (const batch of activeBatches) {
        queued += batch.pendingCount;
        oldest = Math.min(oldest, batch.oldestQueuedAt);
    }
    setGauge('alert_read_batch_queued', queued);
    setGauge(
        'alert_read_batch_oldest_queued_seconds',
        (Date.now() - oldest) / 1000
    );
}

function validateRows(
    rows: unknown,
    requests: readonly Request[],
    scalarFingerprint?: string
): Map<string, OpenInstanceRow> {
    const requested = new Set(requests.map((request) => request.fingerprint));
    const result = new Map<string, OpenInstanceRow>();
    if (!Array.isArray(rows) || rows.length > requested.size) {
        throw Object.assign(new Error('Invalid alert batch response'), {
            code: 'ALERT_READ_INVALID_RESPONSE'
        });
    }
    for (const row of rows) {
        const fingerprint = scalarFingerprint ?? row?.fingerprint;
        if (
            !row ||
            typeof row !== 'object' ||
            !requested.has(fingerprint) ||
            result.has(fingerprint) ||
            !Number.isSafeInteger(row.id) ||
            row.id <= 0 ||
            !ALERT_STATES.some((state) => state === row.state)
        ) {
            throw Object.assign(new Error('Invalid alert batch response'), {
                code: 'ALERT_READ_INVALID_RESPONSE'
            });
        }
        result.set(fingerprint, {fingerprint, id: row.id, state: row.state});
    }
    return result;
}

export class OpenInstanceReadBatch {
    readonly #scope: BatchScope;
    readonly #timing: FlushTiming;
    readonly #outstanding = new Set<Request>();
    readonly #pendingByFingerprint = new Map<
        string,
        Promise<OpenInstanceRow | undefined>
    >();
    #pending: Request[] = [];
    #scheduled = false;
    #closed = false;

    constructor(scope: BatchScope, timing: FlushTiming = 'microtask') {
        this.#scope = {...scope};
        this.#timing = timing;
        activeBatches.add(this);
    }

    get organizationId(): string {
        return this.#scope.organizationId;
    }
    get pendingCount(): number {
        return this.#pending.length;
    }
    get oldestQueuedAt(): number {
        return this.#pending[0]?.queuedAt ?? Date.now();
    }
    get active(): boolean {
        return !this.#closed;
    }
    get idle(): boolean {
        return this.#pending.length === 0 && this.#outstanding.size === 0;
    }

    assertActive(): void {
        if (this.#closed) {
            throw new AlertReadAbortedError(
                'Alert read context closed or invalidated'
            );
        }
    }

    read(fingerprint: string): Promise<OpenInstanceRow | undefined> {
        return this.#enqueue(fingerprint, true);
    }

    queue(fingerprint: string): Promise<OpenInstanceRow | undefined> {
        return this.#enqueue(fingerprint, false);
    }

    async dispatch(): Promise<void> {
        this.assertActive();
        while (this.#pending.length > 0) await this.#flush();
    }

    #enqueue(
        fingerprint: string,
        autoFlush: boolean
    ): Promise<OpenInstanceRow | undefined> {
        this.assertActive();
        const existing = this.#pendingByFingerprint.get(fingerprint);
        if (existing) return existing;
        let resolvePromise!: (row: OpenInstanceRow | undefined) => void;
        let rejectPromise!: (error: unknown) => void;
        const promise = new Promise<OpenInstanceRow | undefined>(
            (resolve, reject) => {
                resolvePromise = resolve;
                rejectPromise = reject;
            }
        );
        const request: Request = {
            fingerprint,
            queuedAt: Date.now(),
            resolve: resolvePromise,
            reject: rejectPromise
        };
        this.#pendingByFingerprint.set(fingerprint, promise);
        this.#outstanding.add(request);
        this.#pending.push(request);
        refreshQueueMetrics();
        if (autoFlush && this.#pending.length === OPEN_INSTANCE_BATCH_LIMIT) {
            void this.#flush();
        } else if (autoFlush && !this.#scheduled) {
            this.#scheduled = true;
            const flush = () => {
                this.#scheduled = false;
                void this.#flush();
            };
            if (this.#timing === 'immediate') setImmediate(flush);
            else queueMicrotask(flush);
        }
        return promise;
    }

    close(): void {
        this.#closed = true;
        const error = new AlertReadAbortedError('Alert read context closed');
        for (const request of this.#outstanding) request.reject(error);
        this.#outstanding.clear();
        this.#pendingByFingerprint.clear();
        this.#pending = [];
        activeBatches.delete(this);
        refreshQueueMetrics();
    }

    async #flush(): Promise<void> {
        // Detach before submitting so later requests always get a new snapshot.
        const requests = this.#pending.splice(0, OPEN_INSTANCE_BATCH_LIMIT);
        for (const request of requests)
            this.#pendingByFingerprint.delete(request.fingerprint);
        refreshQueueMetrics();
        if (requests.length === 0) return;
        const startedAt = Date.now();
        try {
            this.assertActive();
            incrementCounter('alert_read_batch_queries');
            incrementCounter(
                'alert_transition_state_db_loads_total',
                requests.length
            );
            incrementCounter('alert_read_batch_fingerprints', requests.length);
            setGauge('alert_read_batch_last_size', requests.length);
            incrementCounter(
                'alert_read_batch_queue_wait_seconds_total',
                requests.reduce(
                    (sum, request) =>
                        sum + (startedAt - request.queuedAt) / 1000,
                    0
                )
            );
            setGauge(
                'alert_read_batch_last_queue_wait_seconds',
                (startedAt - requests[0].queuedAt) / 1000
            );
            const scalarFingerprint =
                requests.length === 1 ? requests[0].fingerprint : undefined;
            const result =
                scalarFingerprint !== undefined
                    ? await PostgresProvider.callMethod(
                          'notifications.fn_alert_open_instance_by_fingerprint',
                          {
                              p_organization_id: this.#scope.organizationId,
                              p_rule_id: this.#scope.ruleId,
                              p_fingerprint_v2: scalarFingerprint
                          }
                      )
                    : await PostgresProvider.callMethod(
                          'notifications.fn_alert_open_instances_by_fingerprints',
                          {
                              p_organization_id: this.#scope.organizationId,
                              p_rule_id: this.#scope.ruleId,
                              p_fingerprints: requests.map(
                                  (request) => request.fingerprint
                              )
                          }
                      );
            this.assertActive();
            const rows = validateRows(
                result?.rows,
                requests,
                scalarFingerprint
            );
            for (const request of requests)
                request.resolve(rows.get(request.fingerprint));
        } catch (error) {
            incrementCounter('alert_read_batch_errors');
            for (const request of requests) request.reject(error);
        } finally {
            incrementCounter(
                'alert_read_batch_read_seconds_total',
                (Date.now() - startedAt) / 1000
            );
            setGauge(
                'alert_read_batch_last_read_seconds',
                (Date.now() - startedAt) / 1000
            );
            for (const request of requests) this.#outstanding.delete(request);
        }
    }
}

function releaseIdleSharedBatch(
    key: string,
    batch: OpenInstanceReadBatch
): void {
    if (sharedBatches.get(key) !== batch || !batch.idle) return;
    sharedBatches.delete(key);
    batch.close();
}

// Live-event reads: every key of one (tenant, rule) asked in the same
// event-loop turn goes to the database in one query. Results are not kept.
export function readOpenInstance(
    scope: BatchScope,
    fingerprint: string
): Promise<OpenInstanceRow | undefined> {
    const key = JSON.stringify([scope.organizationId, scope.ruleId]);
    let batch = sharedBatches.get(key);
    if (!batch?.active) {
        batch = new OpenInstanceReadBatch(scope, 'immediate');
        sharedBatches.set(key, batch);
    }
    const shared = batch;
    const row = shared.read(fingerprint);
    const release = () => releaseIdleSharedBatch(key, shared);
    void row.then(release, release);
    return row;
}

export function invalidateOpenInstanceReadBatches(
    organizationId?: string
): void {
    for (const batch of activeBatches) {
        if (
            organizationId === undefined ||
            batch.organizationId === organizationId
        )
            batch.close();
    }
}
