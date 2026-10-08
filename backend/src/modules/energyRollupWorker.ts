import {setTimeout as delay} from 'node:timers/promises';
import {getLogger} from 'log4js';
import {tuning} from '../config/tuning';
import {runAsDbWorkload} from './dbWorkPriority';
import * as Observability from './Observability';

const logger = getLogger('energy-rollup-worker');

export type RollupDbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows?: unknown[]} | null | undefined>;

type RollupSleep = (ms: number, signal: AbortSignal) => Promise<void>;

class RollupResultError extends Error {
    readonly code: string;

    constructor(code: 'EM_ROLLUP_INVALID_RESULT' | 'EM_ROLLUP_INVALID_HEALTH') {
        super(code);
        this.name = 'RollupResultError';
        this.code = code;
    }
}

function nonnegativeNumber(value: unknown): number | undefined {
    if (
        typeof value !== 'number' &&
        (typeof value !== 'string' || value.trim() === '')
    ) {
        return undefined;
    }
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

interface RollupBatchResult {
    completed: number;
    blocked: number;
}

function rowCount(row: unknown, field: string): number | undefined {
    const value =
        row && typeof row === 'object' && field in row
            ? (row as Record<string, unknown>)[field]
            : undefined;
    const count = nonnegativeNumber(value);
    return count !== undefined && Number.isSafeInteger(count)
        ? count
        : undefined;
}

function processedCount(
    result: {rows?: unknown[]} | null | undefined
): RollupBatchResult {
    const row = result?.rows?.[0];
    const completed = rowCount(row, 'completed');
    const blocked = rowCount(row, 'blocked');
    if (
        result?.rows?.length !== 1 ||
        completed === undefined ||
        blocked === undefined
    ) {
        throw new RollupResultError('EM_ROLLUP_INVALID_RESULT');
    }
    return {completed, blocked};
}

// Completed keys by the source the projection saved them from.
function completedBySource(
    result: {rows?: unknown[]} | null | undefined
): Record<'em_sync' | 'live', number> {
    const row = result?.rows?.[0];
    const emSync = rowCount(row, 'completed_em_sync');
    const live = rowCount(row, 'completed_live');
    if (emSync === undefined || live === undefined) {
        throw new RollupResultError('EM_ROLLUP_INVALID_RESULT');
    }
    return {em_sync: emSync, live};
}

// Reasons fn_project_rollup_keys holds work with; each is reported, 0 when absent.
const ROLLUP_HOLD_REASONS = [
    'missing_input',
    'conflicting_input',
    'incomplete_history'
] as const;

interface BacklogSplitRow {
    state: 'ready' | 'scheduled' | 'held' | 'abandoned';
    reason: string | null;
    buckets: number;
    oldestAgeSeconds: number;
}

function backlogSplitRow(row: unknown): BacklogSplitRow {
    const fields =
        row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const {state, reason} = fields;
    const buckets = nonnegativeNumber(fields.buckets);
    const oldestAgeSeconds = nonnegativeNumber(fields.oldest_age_seconds);
    const unblocked = state === 'ready' || state === 'scheduled';
    const knownState = unblocked || state === 'held' || state === 'abandoned';
    const reasonValid =
        unblocked || (typeof reason === 'string' && reason !== '');
    if (
        !knownState ||
        !reasonValid ||
        buckets === undefined ||
        !Number.isSafeInteger(buckets) ||
        oldestAgeSeconds === undefined
    ) {
        throw new RollupResultError('EM_ROLLUP_INVALID_HEALTH');
    }
    return {
        state,
        reason: typeof reason === 'string' ? reason : null,
        buckets,
        oldestAgeSeconds
    };
}

function publishBacklogSplit(rows: readonly BacklogSplitRow[]): void {
    const ready = rows.find((row) => row.state === 'ready');
    Observability.setGauge('em_rollup_ready_buckets', ready?.buckets ?? 0);
    Observability.setGauge(
        'em_rollup_ready_oldest_age_seconds',
        ready?.oldestAgeSeconds ?? 0
    );
    Observability.setGauge(
        'em_rollup_scheduled_buckets',
        rows.find((row) => row.state === 'scheduled')?.buckets ?? 0
    );
    const reasons = new Set<string>(ROLLUP_HOLD_REASONS);
    for (const row of rows) if (row.reason) reasons.add(row.reason);
    for (const reason of reasons) {
        const held = rows.find(
            (row) => row.state === 'held' && row.reason === reason
        );
        const abandoned = rows.find(
            (row) => row.state === 'abandoned' && row.reason === reason
        );
        Observability.setLabeledGauge(
            'em_rollup_held_buckets',
            {reason},
            held?.buckets ?? 0
        );
        Observability.setLabeledGauge(
            'em_rollup_held_oldest_bucket_age_seconds',
            {reason},
            held?.oldestAgeSeconds ?? 0
        );
        Observability.setLabeledGauge(
            'em_rollup_abandoned_buckets',
            {reason},
            abandoned?.buckets ?? 0
        );
    }
}

export class EnergyRollupWorker {
    readonly #callDb: RollupDbCaller;
    readonly #observeBacklog: boolean;
    readonly #pollMs: number;
    readonly #idlePollMaxMs: number;
    readonly #sleep: RollupSleep;
    readonly #random: () => number;
    #running = false;
    #loop?: Promise<void>;
    #abort?: AbortController;
    #lastHealthAt = Number.NEGATIVE_INFINITY;

    constructor(
        callDb: RollupDbCaller,
        options: {
            observeBacklog?: boolean;
            pollMs?: number;
            idlePollMaxMs?: number;
            sleep?: RollupSleep;
            random?: () => number;
        } = {}
    ) {
        this.#callDb = callDb;
        this.#observeBacklog = options.observeBacklog ?? true;
        this.#pollMs = options.pollMs ?? tuning.energy.rollupPollMs;
        this.#idlePollMaxMs = Math.max(
            this.#pollMs,
            options.idlePollMaxMs ?? tuning.energy.rollupIdlePollMaxMs
        );
        this.#sleep =
            options.sleep ?? ((ms, signal) => delay(ms, undefined, {signal}));
        this.#random = options.random ?? Math.random;
    }

    start(): void {
        if (this.#loop) return;
        this.#running = true;
        this.#abort = new AbortController();
        this.#lastHealthAt = Number.NEGATIVE_INFINITY;
        this.#loop = this.#run(this.#abort.signal);
    }

    async stop(): Promise<void> {
        this.#running = false;
        this.#abort?.abort();
        await this.#loop;
        this.#loop = undefined;
    }

    async processOnce(): Promise<RollupBatchResult> {
        const started = performance.now();
        const result = await this.#callDb('device_em.fn_rollup_due_batch', {
            p_limit: tuning.energy.rollupBatchSize
        });
        const batch = processedCount(result);
        const bySource = completedBySource(result);
        const count = batch.completed;
        Observability.incrementCounter(
            'em_rollup_blocked_total',
            batch.blocked
        );
        for (const [sourceKind, keys] of Object.entries(bySource)) {
            if (keys === 0) continue;
            Observability.incrementLabeledCounter(
                'em_rollup_completed_keys_total',
                {source_kind: sourceKind},
                keys
            );
        }
        const elapsedSeconds = (performance.now() - started) / 1_000;
        Observability.setGauge(
            'em_rollup_batch_duration_seconds',
            elapsedSeconds
        );
        Observability.setGauge(
            'em_rollup_last_success_timestamp_seconds',
            Math.floor(Date.now() / 1000)
        );
        if (count > 0) {
            Observability.incrementCounter('em_rollup_batches_total');
            Observability.setGauge(
                'em_rollup_last_progress_timestamp_seconds',
                Math.floor(Date.now() / 1000)
            );
        }
        Observability.setGauge(
            'em_rollup_buckets_per_second',
            elapsedSeconds > 0 ? count / elapsedSeconds : count
        );
        return batch;
    }

    async observeHealth(): Promise<void> {
        try {
            const result = await this.#callDb(
                'device_em.fn_rollup_dirty_stats',
                {}
            );
            const row = result?.rows?.[0];
            const count = nonnegativeNumber(
                row && typeof row === 'object' && 'dirty_count' in row
                    ? row.dirty_count
                    : undefined
            );
            const age = nonnegativeNumber(
                row && typeof row === 'object' && 'oldest_age_seconds' in row
                    ? row.oldest_age_seconds
                    : undefined
            );
            if (
                result?.rows?.length !== 1 ||
                count === undefined ||
                !Number.isSafeInteger(count) ||
                age === undefined
            ) {
                throw new RollupResultError('EM_ROLLUP_INVALID_HEALTH');
            }
            const split = await this.#callDb(
                'device_em.fn_rollup_backlog_stats',
                {}
            );
            const splitRows = (split?.rows ?? []).map(backlogSplitRow);
            Observability.setGauge('em_rollup_dirty_buckets', count);
            Observability.setGauge('em_rollup_oldest_dirty_age_seconds', age);
            publishBacklogSplit(splitRows);
            Observability.setGauge('em_rollup_health_valid', 1);
            Observability.setGauge(
                'em_rollup_health_last_success_timestamp_seconds',
                Math.floor(Date.now() / 1000)
            );
        } catch (error) {
            Observability.setGauge('em_rollup_health_valid', 0);
            Observability.incrementCounter('em_rollup_health_failures_total');
            throw error;
        }
    }

    async #run(signal: AbortSignal): Promise<void> {
        let idleDelayMs = this.#pollMs;
        let retryDelayMs = this.#pollMs;
        while (this.#running) {
            let waitMs = 0;
            try {
                const batch = await this.processOnce();
                retryDelayMs = this.#pollMs;
                if (batch.completed === 0 && batch.blocked === 0) {
                    waitMs = idleDelayMs;
                    idleDelayMs = Math.min(
                        this.#idlePollMaxMs,
                        idleDelayMs * 2
                    );
                } else {
                    idleDelayMs = this.#pollMs;
                }
            } catch (error) {
                Observability.incrementCounter('em_rollup_failures_total');
                logger.error('rollup failed', error);
                idleDelayMs = this.#pollMs;
                waitMs = Math.max(
                    this.#pollMs,
                    retryDelayMs * (0.5 + this.#random() / 2)
                );
                retryDelayMs = Math.min(this.#idlePollMaxMs, retryDelayMs * 2);
            }
            const now = Date.now();
            if (
                this.#running &&
                this.#observeBacklog &&
                now - this.#lastHealthAt >= tuning.energy.rollupHealthIntervalMs
            ) {
                this.#lastHealthAt = now;
                try {
                    await this.observeHealth();
                } catch (error) {
                    logger.error('rollup health read failed', error);
                }
            }
            if (this.#running && waitMs > 0) {
                try {
                    await this.#sleep(waitMs, signal);
                } catch (error) {
                    if (!signal.aborted) throw error;
                }
            }
        }
    }
}

let active: EnergyRollupWorker[] = [];

export function startEnergyRollupWorker(callDb: RollupDbCaller): void {
    if (active.length > 0) return;
    active = createEnergyRollupWorkers(callDb, tuning.energy.rollupWorkers);
    logger.info('starting %d rollup worker(s)', active.length);
    for (const worker of active) worker.start();
}

export async function stopEnergyRollupWorker(): Promise<void> {
    const stopping = active;
    active = [];
    await Promise.all(stopping.map((worker) => worker.stop()));
}

// Rollup reads and writes are capped on the shared pool (FM_DB_ROLLUP_MAX_CONNECTIONS).
function asRollupWork(callDb: RollupDbCaller): RollupDbCaller {
    return (method, params) =>
        runAsDbWorkload('rollup', () => callDb(method, params));
}

export function createEnergyRollupWorkers(
    callDb: RollupDbCaller,
    count: number
): EnergyRollupWorker[] {
    const capped = asRollupWork(callDb);
    return Array.from(
        {length: Math.max(1, Math.min(2, Math.floor(count)))},
        (_, index) =>
            new EnergyRollupWorker(capped, {observeBacklog: index === 0})
    );
}
