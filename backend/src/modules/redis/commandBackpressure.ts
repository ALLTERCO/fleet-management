import type {Redis} from 'ioredis';
import * as Observability from '../Observability';

type RedisCommandQueueName = 'commandQueue' | 'offlineQueue';

type RedisCommandQueues = Partial<
    Record<RedisCommandQueueName, {length?: unknown}>
>;

const activeWritesByClient = new WeakMap<Redis, number>();
const maximumDurationMsByLane = new Map<string, number>();

export class RedisQueueIntrospectionError extends Error {
    readonly queue: RedisCommandQueueName;

    constructor(queue: RedisCommandQueueName) {
        super(
            `Redis write backpressure cannot inspect ioredis ${queue}; ` +
                'the installed ioredis version is incompatible'
        );
        this.name = 'RedisQueueIntrospectionError';
        this.queue = queue;
    }
}

export class RedisWriteBackpressureError extends Error {
    readonly pending: number;
    readonly maximum: number;
    readonly lane: string;

    constructor(lane: string, pending: number, maximum: number) {
        super(
            `Redis write backpressure lane=${lane} pending=${pending} maximum=${maximum}`
        );
        this.name = 'RedisWriteBackpressureError';
        this.lane = lane;
        this.pending = pending;
        this.maximum = maximum;
    }
}

export function isRedisWriteBackpressureError(
    err: unknown
): err is RedisWriteBackpressureError {
    return err instanceof RedisWriteBackpressureError;
}

export function pendingRedisCommands(client: Redis): number {
    // ioredis exposes these queues at runtime but declares them private.
    const queued = client as unknown as RedisCommandQueues;
    return (
        redisQueueLength(queued, 'commandQueue') +
        redisQueueLength(queued, 'offlineQueue')
    );
}

function redisQueueLength(
    client: RedisCommandQueues,
    queue: RedisCommandQueueName
): number {
    const length = client[queue]?.length;
    if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0
    ) {
        // Fail closed. Treating an unknown ioredis shape as an empty queue
        // silently removes the memory-safety guard after a dependency upgrade.
        throw new RedisQueueIntrospectionError(queue);
    }
    return length;
}

function activeRedisWrites(client: Redis): number {
    return activeWritesByClient.get(client) ?? 0;
}

function releaseRedisWrite(client: Redis): void {
    const active = activeRedisWrites(client);
    if (active <= 1) {
        activeWritesByClient.delete(client);
        return;
    }
    activeWritesByClient.set(client, active - 1);
}

/**
 * Run one Redis write chain under a shared per-client concurrency bound.
 *
 * The reservation is taken before `write` is called and is held until its
 * promise settles. That closes the check-then-yield race where many async
 * callers could all observe an empty ioredis queue before any command was
 * enqueued. The callback must issue its first Redis command synchronously;
 * subsequent awaited commands remain covered by the same reservation.
 */
export function runWithRedisWriteCapacity<T>(
    client: Redis,
    maximum: number,
    lane: string,
    write: () => Promise<T>
): Promise<T> {
    if (maximum <= 0) return write();
    const pending = Math.max(
        pendingRedisCommands(client),
        activeRedisWrites(client)
    );
    Observability.setLabeledGauge(
        'redis_write_capacity_commands',
        {lane},
        maximum
    );
    Observability.setLabeledGauge(
        'redis_write_pending_commands',
        {lane},
        pending
    );
    if (pending >= maximum) {
        Observability.incrementLabeledCounter(
            'redis_write_backpressure_rejected_total',
            {lane}
        );
        return Promise.reject(
            new RedisWriteBackpressureError(lane, pending, maximum)
        );
    }

    const active = activeRedisWrites(client) + 1;
    activeWritesByClient.set(client, active);
    Observability.setLabeledGauge(
        'redis_write_pending_commands',
        {lane},
        Math.max(pending, active)
    );
    Observability.incrementLabeledCounter('redis_write_admitted_total', {lane});
    const startedAt = performance.now();
    let result: Promise<T>;
    try {
        result = write();
    } catch (err) {
        recordCompletion(client, lane, startedAt, 'error');
        throw err;
    }
    return Promise.resolve(result).then(
        (value) => {
            recordCompletion(client, lane, startedAt, 'success');
            return value;
        },
        (err: unknown) => {
            recordCompletion(client, lane, startedAt, 'error');
            throw err;
        }
    );
}

function recordCompletion(
    client: Redis,
    lane: string,
    startedAt: number,
    outcome: 'success' | 'error'
): void {
    const durationMs = performance.now() - startedAt;
    releaseRedisWrite(client);
    Observability.incrementLabeledCounter('redis_write_completed_total', {
        lane,
        outcome
    });
    Observability.incrementLabeledCounter(
        'redis_write_duration_ms_total',
        {lane},
        durationMs
    );
    const maximum = Math.max(
        maximumDurationMsByLane.get(lane) ?? 0,
        durationMs
    );
    maximumDurationMsByLane.set(lane, maximum);
    Observability.setLabeledGauge(
        'redis_write_duration_ms_max',
        {lane},
        maximum
    );
    Observability.setLabeledGauge(
        'redis_write_pending_commands',
        {lane},
        activeRedisWrites(client)
    );
}
