import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';
import {getCallSites} from 'node:util';
import type {DbWorkPriority} from './dbWorkPriority';

// One database call, split into the parts a load run must tell apart:
// waiting for the priority gate, waiting for a pg connection, the round
// trip, the waits for the event loop after each handover, the hop back to
// the caller, and how long the connection was held.

// The call path: a stored procedure ('procedure') or plain SQL ('sql'). Both
// draw from the one shared pool.
export type DbCallPath = 'procedure' | 'sql';

export const DB_CALL_PHASES = [
    'gate_wait',
    'checkout_wait',
    'query',
    'resume_delay',
    'result_handling',
    'hold'
] as const;

export type DbCallPhase = (typeof DB_CALL_PHASES)[number];

export type DbCallPhases = Partial<Record<DbCallPhase, number>>;

type DbCallMark =
    | 'gateDoneAt'
    | 'gateResumedAt'
    | 'checkoutDoneAt'
    | 'checkoutResumedAt'
    | 'resultAt'
    | 'repliedAt'
    | 'releasedAt';

// Times are performance.now() milliseconds. A *DoneAt or resultAt mark is
// taken in the tick that hands the permit, connection or reply over; the
// matching *ResumedAt or repliedAt mark when the waiting code runs again.
export interface DbCallTiming {
    readonly method: string;
    readonly priority: DbWorkPriority;
    readonly path: DbCallPath;
    readonly startedAt: number;
    claimed: boolean;
    checkoutFailed: boolean;
    // A connection is handed over and not yet back.
    holding?: boolean;
    gateDoneAt?: number;
    gateResumedAt?: number;
    checkoutDoneAt?: number;
    checkoutResumedAt?: number;
    resultAt?: number;
    repliedAt?: number;
    releasedAt?: number;
}

export interface DbCallIdentity {
    method: string;
    priority: DbWorkPriority;
    path: DbCallPath;
}

export function newDbCallTiming(identity: DbCallIdentity): DbCallTiming {
    return {
        ...identity,
        startedAt: performance.now(),
        claimed: false,
        checkoutFailed: false
    };
}

export type DbHoldListener = (timing: DbCallTiming, holding: boolean) => void;

let holdListener: DbHoldListener | undefined;

// The metrics module listens; this module imports nothing from it.
export function onDbHoldChange(listener: DbHoldListener | undefined): void {
    holdListener = listener;
}

// Each hold starts once and ends once, however often release is called.
function setHolding(timing: DbCallTiming, holding: boolean): void {
    if ((timing.holding ?? false) === holding) return;
    timing.holding = holding;
    holdListener?.(timing, holding);
}

export function markDbCall(
    timing: DbCallTiming | undefined,
    mark: DbCallMark
): void {
    if (!timing) return;
    timing[mark] = performance.now();
    if (mark === 'checkoutDoneAt') setHolding(timing, true);
    else if (mark === 'releasedAt') setHolding(timing, false);
}

// A failed checkout has no round trip; only its waits are real.
export function markCheckoutFailed(timing: DbCallTiming | undefined): void {
    if (!timing) return;
    timing.checkoutFailed = true;
    setHolding(timing, false);
}

// The first reaction to the driver's promise, just before the caller's own
// continuation.
export function markReply<T>(
    reply: Promise<T>,
    timing: DbCallTiming | undefined
): Promise<T> {
    if (!timing) return reply;
    return reply.finally(() => markDbCall(timing, 'repliedAt'));
}

type DbReplyCallback<R> = (error: Error | null | undefined, result: R) => void;

// The query surface shared by pg's Pool and Client.
export interface DbQueryTarget<R> {
    query(sql: string, values?: unknown[]): Promise<R>;
    query(
        sql: string,
        values: unknown[] | undefined,
        callback: DbReplyCallback<R>
    ): void;
}

// pg runs a query callback in the tick it reads the reply; a promise
// reaction may wait behind other queued work, so timing uses the callback.
export function sendDbQuery<R>(
    target: DbQueryTarget<R>,
    sql: string,
    values: unknown[] | undefined,
    timing: DbCallTiming | undefined
): Promise<R> {
    if (!timing) return target.query(sql, values);
    const reply = new Promise<R>((resolve, reject) => {
        target.query(sql, values, (error, result) => {
            markDbCall(timing, 'resultAt');
            if (error) reject(error);
            else resolve(result);
        });
    });
    return markReply(reply, timing);
}

const checkoutScope = new AsyncLocalStorage<DbCallTiming>();

// A pool checkout started in the body records its waits on the timing.
export function runWithDbCallTiming<T>(
    timing: DbCallTiming | undefined,
    body: () => Promise<T>
): Promise<T> {
    return timing ? checkoutScope.run(timing, body) : body();
}

// Only the first checkout in the scope owns the timing. A pooled socket
// opened inside the scope keeps it, so later work there must not reuse it.
export function claimDbCallTiming(): DbCallTiming | undefined {
    const timing = checkoutScope.getStore();
    if (!timing || timing.claimed) return undefined;
    timing.claimed = true;
    return timing;
}

function gap(from: number | undefined, to: number | undefined): number {
    return from !== undefined && to !== undefined ? to - from : 0;
}

// Back to back from start to finish; only hold overlaps the others. A mark
// a path does not take falls back to the one before it.
export function dbCallPhases(
    timing: DbCallTiming,
    finishedAt: number
): DbCallPhases {
    const {startedAt, gateDoneAt, gateResumedAt, checkoutDoneAt} = timing;
    const {checkoutResumedAt, resultAt, repliedAt, releasedAt} = timing;
    const phases: DbCallPhases = {};
    if (gateDoneAt !== undefined) phases.gate_wait = gateDoneAt - startedAt;
    if (gateDoneAt !== undefined && checkoutDoneAt !== undefined) {
        phases.checkout_wait = checkoutDoneAt - (gateResumedAt ?? gateDoneAt);
    }
    if (timing.checkoutFailed) return phases;
    if (repliedAt !== undefined) {
        const sentAt = checkoutResumedAt ?? checkoutDoneAt ?? startedAt;
        phases.query = (resultAt ?? repliedAt) - sentAt;
        phases.result_handling = finishedAt - repliedAt;
    }
    const resumed = [gateResumedAt, checkoutResumedAt, resultAt];
    if (resumed.some((mark) => mark !== undefined)) {
        phases.resume_delay =
            gap(gateDoneAt, gateResumedAt) +
            gap(checkoutDoneAt, checkoutResumedAt) +
            gap(resultAt, repliedAt);
    }
    if (checkoutDoneAt !== undefined && releasedAt !== undefined) {
        phases.hold = releasedAt - checkoutDoneAt;
    }
    return phases;
}

// Files of the database layer itself; the label names the code above them.
const DB_LAYER_FILES = new Set([
    'dbCallTiming',
    'dbCallMetrics',
    'PostgresProvider',
    'postgresStoredProcedureBridge',
    'postgresPriorityPool',
    'postgresTransactionScope',
    'postgresTx'
]);
// A repository function named queryRows only forwards to the database layer.
const FORWARDING_FUNCTIONS = new Set(['queryRows']);
const CALL_SITE_FRAMES = 10;

function scriptStem(scriptName: string): string {
    return path.basename(scriptName, path.extname(scriptName));
}

// A short static name for the code that issued the call: file and function,
// or file and line when the function has no name.
export function dbCallSiteLabel(): string {
    for (const site of getCallSites(CALL_SITE_FRAMES)) {
        if (!site.scriptName || site.scriptName.startsWith('node:')) continue;
        const file = scriptStem(site.scriptName);
        if (DB_LAYER_FILES.has(file)) continue;
        if (FORWARDING_FUNCTIONS.has(site.functionName)) continue;
        return site.functionName
            ? `${file}.${site.functionName}`
            : `${file}:${site.lineNumber}`;
    }
    return 'unknown';
}
