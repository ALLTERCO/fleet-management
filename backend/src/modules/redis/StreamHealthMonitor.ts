// Periodic XLEN probe. Raises `fm_stream_overflow_total{stream}` when XLEN
// drifts past MAXLEN × ratio (MAXLEN is approximate — XADD MAXLEN ~ trims
// lazily, so transient overshoot is expected; the ratio guards real growth).
// Also probes Redis memory/eviction each tick (fm_redis_* gauges) so the
// REDIS_MAX_MEMORY headroom — shared by every stream — stays visible.
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import * as Observability from '../Observability';
import type {GaugeName} from '../observability/counters';
import {setRedisRuntimeSnapshot} from './runtimeInfo';

const logger = log4js.getLogger('stream-health-monitor');

export interface MonitoredStream {
    key: string;
    maxlen: number;
    label: string;
}

// Exported for unit-testing without touching the timer.
export async function probeStream(
    client: Redis,
    stream: MonitoredStream,
    overflowRatio: number
): Promise<void> {
    let len: number;
    try {
        len = await client.xlen(stream.key);
    } catch (err) {
        logger.warn('xlen failed for %s: %s', stream.key, err);
        return;
    }
    Observability.setLabeledGauge('stream_length', {stream: stream.label}, len);
    if (len > stream.maxlen * overflowRatio) {
        Observability.incrementLabeledCounter('stream_overflow_total', {
            stream: stream.label
        });
        logger.warn(
            'stream %s past cap: len=%d maxlen=%d ratio=%s',
            stream.label,
            len,
            stream.maxlen,
            overflowRatio.toFixed(2)
        );
    }
}

// Extract one numeric field from a redis INFO section ("field:value" lines).
function parseInfoField(info: string, field: string): number {
    const m = info.match(new RegExp(`^${field}:(.+)$`, 'm'));
    return m ? Number(m[1]) : Number.NaN;
}

function parseInfoString(info: string, field: string): string {
    const match = info.match(new RegExp(`^${field}:(.+)$`, 'm'));
    return match?.[1]?.trim() ?? '';
}

// Redis memory + eviction telemetry. A non-zero evicted-keys rate means the
// maxmemory cap is being hit — the signal that the streams have outgrown
// REDIS_MAX_MEMORY. Exported for unit-testing without the timer.
export async function probeRedisMemory(client: Redis): Promise<void> {
    let mem: string;
    let stats: string;
    let server: string;
    let persistence: string;
    try {
        [mem, stats, server, persistence] = await Promise.all([
            client.info('memory'),
            client.info('stats'),
            client.info('server'),
            client.info('persistence')
        ]);
    } catch (err) {
        logger.warn('redis info failed: %s', err);
        return;
    }
    const readings: ReadonlyArray<readonly [GaugeName, number]> = [
        ['redis_used_memory_bytes', parseInfoField(mem, 'used_memory')],
        ['redis_maxmemory_bytes', parseInfoField(mem, 'maxmemory')],
        [
            'redis_mem_fragmentation_ratio',
            parseInfoField(mem, 'mem_fragmentation_ratio')
        ],
        ['redis_evicted_keys', parseInfoField(stats, 'evicted_keys')]
    ];
    for (const [name, value] of readings) {
        if (Number.isFinite(value)) Observability.setGauge(name, value);
    }
    const aofEnabled = parseInfoField(persistence, 'aof_enabled');
    setRedisRuntimeSnapshot({
        version: parseInfoString(server, 'redis_version') || 'unknown',
        evictionPolicy: parseInfoString(mem, 'maxmemory_policy') || 'unknown',
        aofEnabled: Number.isFinite(aofEnabled) ? aofEnabled === 1 : null
    });
    Observability.setGauge(
        'redis_last_success_timestamp_seconds',
        Math.floor(Date.now() / 1000)
    );
}

export class StreamHealthMonitor {
    readonly #client: Redis;
    readonly #streams: ReadonlyArray<MonitoredStream>;
    readonly #intervalMs: number;
    readonly #overflowRatio: number;
    #timer: NodeJS.Timeout | null = null;
    #tickRunning = false;

    constructor(
        client: Redis,
        streams: ReadonlyArray<MonitoredStream>,
        intervalMs: number,
        overflowRatio: number
    ) {
        this.#client = client;
        this.#streams = streams;
        this.#intervalMs = intervalMs;
        this.#overflowRatio = overflowRatio;
    }

    start(): void {
        if (this.#timer !== null) return;
        this.#timer = setInterval(() => {
            void this.#tick();
        }, this.#intervalMs);
        this.#timer.unref?.();
        void this.#tick();
        logger.info(
            'started monitor for %d stream(s) every %dms',
            this.#streams.length,
            this.#intervalMs
        );
    }

    stop(): void {
        if (this.#timer !== null) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }

    async #tick(): Promise<void> {
        if (this.#tickRunning) return;
        this.#tickRunning = true;
        try {
            await probeRedisMemory(this.#client);
            for (const stream of this.#streams) {
                await probeStream(this.#client, stream, this.#overflowRatio);
            }
        } finally {
            this.#tickRunning = false;
        }
    }
}
