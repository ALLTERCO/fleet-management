import type {Pool} from 'pg';
import {Counter, Gauge} from 'prom-client';
import {type DbCallTiming, onDbHoldChange} from '../dbCallTiming';
import type {DbCheckoutGateOccupancy} from '../postgresPriorityPool';
import {registry} from './registry';

// Pool signals a 10 s scrape of live gauges cannot give: time at each permit
// level, time a priority waited while a connection was free, connections each
// kind of work held and was granted, connection churn, and how many
// connections each kind of work held at its peak.

export const HOLD_PEAK_WINDOW_MS = 10_000;

interface GateSource {
    gateOccupancy(): DbCheckoutGateOccupancy;
}

const gates = new Map<string, GateSource>();
// Per counter, since two counters may share a label set.
const reportedTotals = new WeakMap<Counter<string>, Map<string, number>>();

// The gate keeps totals; a counter only moves forward by what is new.
function advance(
    counter: Counter<string>,
    labels: Record<string, string>,
    total: number
): void {
    let reported = reportedTotals.get(counter);
    if (!reported) {
        reported = new Map();
        reportedTotals.set(counter, reported);
    }
    const key = JSON.stringify(labels);
    const before = reported.get(key) ?? 0;
    if (total <= before) return;
    counter.inc(labels, total - before);
    reported.set(key, total);
}

new Counter({
    name: 'fm_db_gate_in_use_seconds_total',
    help: 'Seconds the pool gate spent with this many permits in use',
    labelNames: ['pool', 'in_use'],
    registers: [registry],
    collect() {
        for (const [pool, gate] of gates) {
            gate.gateOccupancy().msAtInUse.forEach((ms, inUse) => {
                advance(this, {pool, in_use: String(inUse)}, ms / 1000);
            });
        }
    }
});

new Counter({
    name: 'fm_db_gate_wait_with_room_seconds_total',
    help: 'Seconds a priority had a waiter at the pool gate while a connection it may use was free',
    labelNames: ['pool', 'priority'],
    registers: [registry],
    collect() {
        for (const [pool, gate] of gates) {
            const room = gate.gateOccupancy().msWaitingWithRoom;
            advance(
                this,
                {pool, priority: 'foreground'},
                room.foreground / 1000
            );
            advance(
                this,
                {pool, priority: 'background'},
                room.background / 1000
            );
        }
    }
});

const SHARES = ['guaranteed', 'borrowed'] as const;

new Counter({
    name: 'fm_db_gate_workload_held_seconds_total',
    help: 'Connection-seconds one kind of work held through the pool gate, within its cap (guaranteed) or above it on idle connections (borrowed)',
    labelNames: ['pool', 'workload', 'share'],
    registers: [registry],
    collect() {
        for (const [pool, gate] of gates) {
            const workloads = gate.gateOccupancy().workloads;
            for (const [workload, sums] of Object.entries(workloads)) {
                for (const share of SHARES) {
                    advance(
                        this,
                        {pool, workload, share},
                        sums.msHeld[share] / 1000
                    );
                }
            }
        }
    }
});

new Counter({
    name: 'fm_db_gate_workload_grants_total',
    help: 'Connections the pool gate granted to one kind of work, within its cap (guaranteed) or above it on idle connections (borrowed)',
    labelNames: ['pool', 'workload', 'share'],
    registers: [registry],
    collect() {
        for (const [pool, gate] of gates) {
            const workloads = gate.gateOccupancy().workloads;
            for (const [workload, sums] of Object.entries(workloads)) {
                for (const share of SHARES) {
                    advance(this, {pool, workload, share}, sums.grants[share]);
                }
            }
        }
    }
});

const opened = new Counter({
    name: 'fm_db_pool_connections_opened_total',
    help: 'PostgreSQL connections opened by the pool',
    labelNames: ['pool'],
    registers: [registry]
});

const closed = new Counter({
    name: 'fm_db_pool_connections_closed_total',
    help: 'PostgreSQL connections the pool closed or lost',
    labelNames: ['pool'],
    registers: [registry]
});

export function watchDbGate(pool: string, gate: GateSource): void {
    gates.set(pool, gate);
}

export function watchPoolConnections(pool: string, pg: Pool): void {
    pg.on('connect', () => opened.inc({pool}));
    pg.on('remove', () => closed.inc({pool}));
}

export interface WindowPeak {
    level: number;
    windowStart: number;
    max: number;
    lastMax: number;
}

export function newWindowPeak(now: number): WindowPeak {
    const windowStart = now - (now % HOLD_PEAK_WINDOW_MS);
    return {level: 0, windowStart, max: 0, lastMax: 0};
}

function rollWindowPeak(peak: WindowPeak, now: number): void {
    const windowStart = now - (now % HOLD_PEAK_WINDOW_MS);
    if (windowStart === peak.windowStart) return;
    // More than one window passed with no change: the level held throughout.
    peak.lastMax =
        windowStart - peak.windowStart > HOLD_PEAK_WINDOW_MS
            ? peak.level
            : peak.max;
    peak.windowStart = windowStart;
    peak.max = peak.level;
}

export function noteWindowPeak(
    peak: WindowPeak,
    level: number,
    now: number
): void {
    rollWindowPeak(peak, now);
    peak.level = level;
    if (level > peak.max) peak.max = level;
}

// The highest level of the last complete window.
export function readWindowPeak(peak: WindowPeak, now: number): number {
    rollWindowPeak(peak, now);
    return peak.lastMax;
}

const holdPeaks = new Map<string, WindowPeak>();

function holdKey(timing: DbCallTiming): string {
    return `${timing.method}\n${timing.priority}\n${timing.path}`;
}

new Gauge({
    name: 'fm_db_calls_holding_peak',
    help: 'Most connections this method held at once in the last complete 10 s window',
    labelNames: ['method', 'priority', 'path'],
    registers: [registry],
    collect() {
        const now = Date.now();
        for (const [key, peak] of holdPeaks) {
            const [method, priority, path] = key.split('\n');
            this.set({method, priority, path}, readWindowPeak(peak, now));
        }
    }
});

// Holds are seen only for timed calls (FM_DB_TIMING_DETAIL).
export function startHoldPeaks(): void {
    onDbHoldChange((timing, holding) => {
        const key = holdKey(timing);
        const now = Date.now();
        let peak = holdPeaks.get(key);
        if (!peak) {
            peak = newWindowPeak(now);
            holdPeaks.set(key, peak);
        }
        noteWindowPeak(peak, peak.level + (holding ? 1 : -1), now);
    });
}
