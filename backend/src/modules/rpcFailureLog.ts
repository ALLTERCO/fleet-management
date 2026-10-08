// Log level for a failed RPC. The level is read from the error the handler
// raised, never from the fact that one was raised: an operator must be able to
// trust that every ERROR line is something to act on.
//
// Leaf module on purpose. Handlers deep in the model layer stamp the reason
// below, and they must stay loadable without the metrics and config graph.

import {categoryFor} from '../rpc/errors';
import RpcError from '../rpc/RpcError';

/**
 * `details.reason` a handler stamps when it refuses because the requested
 * period holds no recorded measurement at all. A device that joined today has
 * nothing yet, and a dashboard asks again on every poll.
 */
export const NO_RECORDED_DATA_REASON = 'no_recorded_data';

export type RpcFailureLevel = 'error' | 'debug';

export interface RpcFailureLogger {
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}

// Categories that mean the server, a device or a dependency broke. A stamped
// reason never quiets one of these, whoever raised it.
const FAULT_CATEGORIES = new Set(['server', 'unavailable', 'device']);

// The dispatcher catches the error envelope, so `details.reason` is read off
// an unknown throw exactly as the error contract shapes it.
function refusalReason(err: unknown): unknown {
    if (!err || typeof err !== 'object') return undefined;
    const data = (err as {data?: unknown}).data;
    if (!data || typeof data !== 'object') return undefined;
    const details = (data as {details?: unknown}).details;
    if (!details || typeof details !== 'object') return undefined;
    return (details as {reason?: unknown}).reason;
}

/**
 * Only an outcome a handler declared normal is quiet. Everything else keeps
 * the level it has always had, so nothing is demoted to shorten the log.
 */
export function rpcFailureLevel(err: unknown): RpcFailureLevel {
    if (refusalReason(err) !== NO_RECORDED_DATA_REASON) return 'error';
    const code = RpcError.codeOf(err);
    // No code at all is an escaped throw, which is always a fault.
    if (code === undefined) return 'error';
    return FAULT_CATEGORIES.has(categoryFor(code)) ? 'error' : 'debug';
}

export function logRpcFailure(
    logger: RpcFailureLogger,
    err: unknown,
    method: string,
    params: string
): void {
    logger[rpcFailureLevel(err)](
        'Sending error:[%s] method:[%s] params:[%s]',
        RpcError.messageOf(err) ?? 'Internal error',
        method,
        params
    );
}
