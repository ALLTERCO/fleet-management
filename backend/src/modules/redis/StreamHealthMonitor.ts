// Periodic XLEN probe. Raises `fm_stream_overflow_total{stream}` when XLEN
// drifts past MAXLEN × ratio (MAXLEN is approximate — XADD MAXLEN ~ trims
// lazily, so transient overshoot is expected; the ratio guards real growth).
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import * as Observability from '../Observability';

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

export class StreamHealthMonitor {
    readonly #client: Redis;
    readonly #streams: ReadonlyArray<MonitoredStream>;
    readonly #intervalMs: number;
    readonly #overflowRatio: number;
    #timer: NodeJS.Timeout | null = null;

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
        for (const stream of this.#streams) {
            await probeStream(this.#client, stream, this.#overflowRatio);
        }
    }
}
