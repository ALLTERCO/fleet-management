import {
    type EventLoopUtilization,
    type IntervalHistogram,
    monitorEventLoopDelay,
    performance
} from 'node:perf_hooks';

// Loop delay and utilization for one scrape window: each read resets them,
// so a 1 s scrape shows that second instead of a lifetime blend.

const DELAY_RESOLUTION_MS = 1;
const NS_PER_SECOND = 1e9;

export interface EventLoopDelayWindow {
    p50Seconds: number;
    p99Seconds: number;
    maxSeconds: number;
    samples: number;
    sumSeconds: number;
}

export interface EventLoopWindow {
    seconds: number;
    utilization: number;
    delay?: EventLoopDelayWindow;
}

export interface EventLoopTotals {
    activeSeconds: number;
    idleSeconds: number;
    delaySamples: number;
    delaySeconds: number;
}

// The part of an IntervalHistogram a window reads; values in nanoseconds.
export interface DelayHistogram {
    readonly count: number;
    readonly mean: number;
    readonly max: number;
    percentile(percentile: number): number;
}

let delayHistogram: IntervalHistogram | undefined;
let windowStart: EventLoopUtilization | undefined;
let delaySamplesTotal = 0;
let delaySecondsTotal = 0;

export interface EventLoopWindowOptions {
    // The 1 ms delay timer costs 1-2% of a core, so it is opt-in.
    withDelay: boolean;
}

export function startEventLoopWindow(options: EventLoopWindowOptions): void {
    windowStart ??= performance.eventLoopUtilization();
    if (delayHistogram || !options.withDelay) return;
    delayHistogram = monitorEventLoopDelay({resolution: DELAY_RESOLUTION_MS});
    delayHistogram.enable();
}

export function stopEventLoopWindow(): void {
    delayHistogram?.disable();
    delayHistogram = undefined;
    windowStart = undefined;
}

export function readDelayWindow(
    histogram: DelayHistogram
): EventLoopDelayWindow {
    if (histogram.count === 0) {
        return {
            p50Seconds: 0,
            p99Seconds: 0,
            maxSeconds: 0,
            samples: 0,
            sumSeconds: 0
        };
    }
    return {
        p50Seconds: histogram.percentile(50) / NS_PER_SECOND,
        p99Seconds: histogram.percentile(99) / NS_PER_SECOND,
        maxSeconds: histogram.max / NS_PER_SECOND,
        samples: histogram.count,
        sumSeconds: (histogram.count * histogram.mean) / NS_PER_SECOND
    };
}

export function readUtilizationWindow(
    delta: EventLoopUtilization
): Pick<EventLoopWindow, 'seconds' | 'utilization'> {
    return {
        seconds: (delta.active + delta.idle) / 1000,
        utilization: delta.utilization
    };
}

// Reads and resets the window. Meant for one scraper; a second one would
// split the windows between them. Node drops the first delay sample after a
// reset, so the delay of the reading tick is lost; utilization still has it.
export function takeEventLoopWindow(): EventLoopWindow | undefined {
    if (!windowStart) return undefined;
    const now = performance.eventLoopUtilization();
    const window: EventLoopWindow = readUtilizationWindow(
        performance.eventLoopUtilization(now, windowStart)
    );
    windowStart = now;
    if (delayHistogram) {
        window.delay = readDelayWindow(delayHistogram);
        delayHistogram.reset();
        delaySamplesTotal += window.delay.samples;
        delaySecondsTotal += window.delay.sumSeconds;
    }
    return window;
}

export function eventLoopTotals(): EventLoopTotals {
    const {active, idle} = performance.eventLoopUtilization();
    return {
        activeSeconds: active / 1000,
        idleSeconds: idle / 1000,
        delaySamples: delaySamplesTotal,
        delaySeconds: delaySecondsTotal
    };
}
