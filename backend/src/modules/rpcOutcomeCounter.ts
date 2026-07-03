// Tag an RPC handler with a Prometheus outcome counter. Each call emits
// exactly one increment so per-method cardinality is bounded.

import log4js from 'log4js';
import {incrementLabeledCounter} from './Observability';
import {formatError} from './util/formatError';

const logger = log4js.getLogger('rpcOutcomeCounter');

const SUCCESS_OUTCOME = 'ok';
const FALLBACK_ERROR_OUTCOME = 'error';

export type OutcomeClassifier = (err: unknown) => string;

export interface OutcomeCounterSpec<T> {
    metric: string;
    classify: OutcomeClassifier;
    run: () => Promise<T>;
}

function safeClassify(
    metric: string,
    classify: OutcomeClassifier,
    err: unknown
): string {
    try {
        return classify(err);
    } catch (classifierErr) {
        logger.error(
            'classifier threw for metric=%s: %s',
            metric,
            formatError(classifierErr)
        );
        return FALLBACK_ERROR_OUTCOME;
    }
}

export async function withOutcomeCounter<T>(
    spec: OutcomeCounterSpec<T>
): Promise<T> {
    let outcome = SUCCESS_OUTCOME;
    try {
        return await spec.run();
    } catch (err) {
        outcome = safeClassify(spec.metric, spec.classify, err);
        throw err;
    } finally {
        incrementLabeledCounter(spec.metric, {outcome});
    }
}

// Per-arm helper for branches that must record an outcome before throwing
// (i.e. when the classifier cannot recover the outcome from the error alone).
export function recordOutcome(metric: string, outcome: string): void {
    incrementLabeledCounter(metric, {outcome});
}

// Pull the JSON-RPC code from an unknown thrown value. RpcError exposes it
// via its `code` getter; non-RpcError throws yield undefined.
export function rpcErrorCode(err: unknown): number | undefined {
    if (err && typeof err === 'object' && 'code' in err) {
        const c = (err as {code: unknown}).code;
        if (typeof c === 'number') return c;
    }
    return undefined;
}

// Shared code→label dispatch — components pass their own table and get
// 'error' for anything the table doesn't list. Keeps platform-caused
// failures (PG outage, network error) from masquerading as user errors.
export function classifyByCode(table: Record<number, string>) {
    return (err: unknown): string => {
        const code = rpcErrorCode(err);
        if (code === undefined) return FALLBACK_ERROR_OUTCOME;
        return table[code] ?? FALLBACK_ERROR_OUTCOME;
    };
}

// Pull a structured detail field (e.g. `operation`) off an RpcError-shaped
// throw. Returns undefined for non-RpcErrors or when the field is absent.
export function rpcErrorDetail(err: unknown, key: string): unknown {
    if (!err || typeof err !== 'object' || !('data' in err)) return undefined;
    const data = (err as {data: unknown}).data;
    if (!data || typeof data !== 'object') return undefined;
    const direct = (data as Record<string, unknown>)[key];
    if (direct !== undefined) return direct;
    const details = (data as {details?: unknown}).details;
    if (!details || typeof details !== 'object') return undefined;
    return (details as Record<string, unknown>)[key];
}
