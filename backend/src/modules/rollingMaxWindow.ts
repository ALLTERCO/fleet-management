// Idempotent peek of the max sample within a sliding ms window.
// Replaces reset-on-read so multiple consumers see the same value.

function assertPositiveMs(windowMs: number): void {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw new Error(
            `RollingMaxWindow windowMs must be positive, got ${windowMs}`
        );
    }
}

function assertFiniteSample(value: number): void {
    if (Number.isNaN(value)) {
        throw new Error('RollingMaxWindow sample value must not be NaN');
    }
}

interface Sample {
    ts: number;
    value: number;
}

export class RollingMaxWindow {
    readonly #windowMs: number;
    readonly #samples: Sample[] = [];

    constructor(windowMs: number) {
        assertPositiveMs(windowMs);
        this.#windowMs = windowMs;
    }

    record(value: number, ts: number = Date.now()): void {
        assertFiniteSample(value);
        this.#samples.push({ts, value});
        this.#dropExpired(ts - this.#windowMs);
    }

    peak(now: number = Date.now()): number {
        const cutoff = now - this.#windowMs;
        let max = 0;
        for (const s of this.#samples) {
            if (s.ts >= cutoff && s.value > max) max = s.value;
        }
        return max;
    }

    reset(): void {
        this.#samples.length = 0;
    }

    size(): number {
        return this.#samples.length;
    }

    #dropExpired(cutoffTs: number): void {
        while (this.#samples.length > 0 && this.#samples[0].ts < cutoffTs) {
            this.#samples.shift();
        }
    }
}
