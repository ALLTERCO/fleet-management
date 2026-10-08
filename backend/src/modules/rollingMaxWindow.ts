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
    #samples: Sample[] = [];
    #head = 0;

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
        for (let i = this.#head; i < this.#samples.length; i++) {
            const s = this.#samples[i];
            if (s.ts >= cutoff && s.value > max) max = s.value;
        }
        return max;
    }

    reset(): void {
        this.#samples.length = 0;
        this.#head = 0;
    }

    size(): number {
        return this.#samples.length - this.#head;
    }

    #dropExpired(cutoffTs: number): void {
        while (
            this.#head < this.#samples.length &&
            this.#samples[this.#head].ts < cutoffTs
        ) {
            this.#head++;
        }
        // Front deletion with Array.shift() copies the remaining array for
        // every sample and was a measured CPU hotspot under device bursts.
        // Compact only occasionally, keeping queue operations amortized O(1).
        if (this.#head >= 4096 && this.#head * 2 >= this.#samples.length) {
            this.#samples = this.#samples.slice(this.#head);
            this.#head = 0;
        }
    }
}
