import os from 'node:os';
import {Counter, Gauge} from 'prom-client';
import {registry} from './registry';

export function mirrorCounter(
    name: string,
    help: string,
    read: () => number
): Counter {
    return new Counter({
        name,
        help,
        registers: [registry],
        collect() {
            this.reset();
            this.inc(read());
        }
    });
}

export function mirrorLabeledCounter(
    name: string,
    help: string,
    fill: (c: Counter<'method'>) => void
): Counter<'method'> {
    return new Counter({
        name,
        help,
        labelNames: ['method'],
        registers: [registry],
        collect() {
            this.reset();
            fill(this);
        }
    });
}

export function mirrorLabeledGauge(
    name: string,
    help: string,
    fill: (g: Gauge<'method'>) => void
): Gauge<'method'> {
    return new Gauge({
        name,
        help,
        labelNames: ['method'],
        registers: [registry],
        collect() {
            this.reset();
            fill(this);
        }
    });
}

export function liveGauge(
    name: string,
    help: string,
    read: () => number
): Gauge {
    return new Gauge({
        name,
        help,
        registers: [registry],
        collect() {
            this.set(read());
        }
    });
}

liveGauge('fm_up', 'Whether the fleet manager is up', () => 1);
liveGauge('fm_uptime_seconds', 'Process uptime in seconds', () =>
    Math.round(process.uptime())
);
liveGauge(
    'fm_memory_rss_bytes',
    'Resident set size in bytes',
    () => process.memoryUsage().rss
);
liveGauge(
    'fm_memory_heap_used_bytes',
    'V8 heap used in bytes',
    () => process.memoryUsage().heapUsed
);
liveGauge(
    'fm_memory_heap_total_bytes',
    'V8 heap total in bytes',
    () => process.memoryUsage().heapTotal
);
liveGauge(
    'fm_memory_external_bytes',
    'V8 external memory in bytes',
    () => process.memoryUsage().external ?? 0
);
liveGauge(
    'fm_memory_array_buffers_bytes',
    'V8 array buffers in bytes',
    () => process.memoryUsage().arrayBuffers ?? 0
);
liveGauge('fm_os_free_memory_bytes', 'OS free memory in bytes', () =>
    os.freemem()
);
liveGauge('fm_os_total_memory_bytes', 'OS total memory in bytes', () =>
    os.totalmem()
);
liveGauge('fm_os_load_1m', 'OS 1-minute load average', () => os.loadavg()[0]);
liveGauge('fm_os_load_5m', 'OS 5-minute load average', () => os.loadavg()[1]);
liveGauge('fm_os_load_15m', 'OS 15-minute load average', () => os.loadavg()[2]);
liveGauge('fm_os_cpus', 'Number of CPU cores', () => os.cpus().length);

export function activeCount(
    fn: '_getActiveHandles' | '_getActiveRequests'
): number {
    const p = process as unknown as Record<string, () => unknown[]>;
    return p[fn]?.().length ?? 0;
}
liveGauge('fm_active_handles', 'Active Node.js handles', () =>
    activeCount('_getActiveHandles')
);
liveGauge('fm_active_requests', 'Active Node.js async requests', () =>
    activeCount('_getActiveRequests')
);
