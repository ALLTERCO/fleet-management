import {getLogger} from 'log4js';
import {Gauge, Histogram} from 'prom-client';
import {tuning} from '../../config/tuning';
import {noteDbCall} from '../dbCallCount';
import {
    DB_CALL_PHASES,
    type DbCallPath,
    type DbCallPhase,
    type DbCallTiming,
    dbCallPhases,
    newDbCallTiming
} from '../dbCallTiming';
import {currentDbWorkPriority} from '../dbWorkPriority';
import {registry} from './registry';
import {getLevel} from './samplers';

const LABELS = ['method', 'priority', 'path'] as const;

const phaseSeconds = new Histogram({
    name: 'fm_db_call_phase_seconds',
    help: 'Database call time by phase: gate_wait, checkout_wait, query, resume_delay, result_handling, hold',
    labelNames: [...LABELS, 'phase'] as const,
    buckets: [
        0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5,
        1, 2.5, 5, 10
    ],
    registers: [registry]
});

const inFlight = new Gauge({
    name: 'fm_db_calls_in_flight',
    help: 'Database calls started and not yet finished, by method',
    labelNames: LABELS,
    registers: [registry]
});

type CallLabel = (typeof LABELS)[number];

interface CallSeries {
    phases: Record<DbCallPhase, Histogram.Internal<CallLabel | 'phase'>>;
    inFlight: Gauge.Internal<CallLabel>;
}

const logger = getLogger('observability');
const OVERFLOW_METHOD = 'other';
const admittedMethods = new Set<string>();
const seriesByKey = new Map<string, CallSeries>();
let capLogged = false;

export function isDbCallDetailOn(): boolean {
    return tuning.observability.dbTimingDetail && getLevel() >= 2;
}

// Past the cap, new methods share one series instead of growing the scrape.
function methodLabel(method: string): string {
    if (admittedMethods.has(method)) return method;
    if (admittedMethods.size < tuning.observability.labeledSeriesPerNameMax) {
        admittedMethods.add(method);
        return method;
    }
    if (!capLogged) {
        capLogged = true;
        logger.warn(
            'fm_db_call_phase_seconds reached %d methods; new methods count as other',
            admittedMethods.size
        );
    }
    return OVERFLOW_METHOD;
}

function seriesFor(timing: DbCallTiming): CallSeries {
    const key = `${timing.method}\n${timing.priority}\n${timing.path}`;
    let series = seriesByKey.get(key);
    if (series) return series;
    const labels = {
        method: timing.method,
        priority: timing.priority,
        path: timing.path
    };
    const phase = (name: DbCallPhase) =>
        phaseSeconds.labels({...labels, phase: name});
    series = {
        phases: {
            gate_wait: phase('gate_wait'),
            checkout_wait: phase('checkout_wait'),
            query: phase('query'),
            resume_delay: phase('resume_delay'),
            result_handling: phase('result_handling'),
            hold: phase('hold')
        },
        inFlight: inFlight.labels(labels)
    };
    seriesByKey.set(key, series);
    return series;
}

export function startDbCall(method: string, path: DbCallPath): DbCallTiming {
    const timing = newDbCallTiming({
        method: methodLabel(method),
        priority: currentDbWorkPriority(),
        path
    });
    seriesFor(timing).inFlight.inc();
    return timing;
}

export interface DbCallSpec {
    path: DbCallPath;
    // Called only when timing is on, before the first await.
    method: () => string;
}

// Off: the plain call. On: the same call, timed by phase.
export function timeDbCall<T>(
    spec: DbCallSpec,
    send: (timing: DbCallTiming | undefined) => Promise<T>
): Promise<T> {
    noteDbCall();
    if (!isDbCallDetailOn()) return send(undefined);
    return sendTimed(startDbCall(spec.method(), spec.path), send);
}

async function sendTimed<T>(
    timing: DbCallTiming,
    send: (timing: DbCallTiming) => Promise<T>
): Promise<T> {
    try {
        return await send(timing);
    } finally {
        finishDbCall(timing);
    }
}

export function finishDbCall(timing: DbCallTiming): void {
    const series = seriesFor(timing);
    series.inFlight.dec();
    const phases = dbCallPhases(timing, performance.now());
    for (const phase of DB_CALL_PHASES) {
        const ms = phases[phase];
        if (ms !== undefined)
            series.phases[phase].observe(Math.max(0, ms) / 1000);
    }
}
