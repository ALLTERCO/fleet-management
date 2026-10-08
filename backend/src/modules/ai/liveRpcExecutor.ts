// Runs one internal RPC as a given user and returns the result, reusing
// the normal MessageHandler path so permission decorators enforce access
// (deny-by-default) and Commander audits the call (logRpc). An error
// envelope from the RPC layer is rethrown so the caller surfaces it as a
// JSON-RPC error — the MCP live tools rely on this for authorization: no
// permission → error, never silent success.
//
// Rate limiting is applied here because handleInternalCommands does not
// (its HTTP/WS callers do); MCP is a third caller, so it mirrors them.

import type {JsonRpcIncoming} from '../../rpc/types';
import type {Sendable, user_t} from '../../types';
import {enforceRateLimit} from '../web/rateLimit';
import MessageHandler from '../web/ws/MessageHandler';
import {McpError} from './mcpErrors.js';

// Stateless dispatcher; builds a per-call CommandSender from the user.
const messageHandler = new MessageHandler();

export interface RpcErrorEnvelope {
    code: number;
    message: string;
    data?: {fieldErrors?: unknown; details?: unknown};
}

interface Captured {
    result?: unknown;
    error?: RpcErrorEnvelope;
}

function collectingSendable(captured: Captured): Sendable {
    return {
        send(data: string) {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
                captured.error = parsed.error;
                return;
            }
            captured.result = parsed?.result ?? parsed;
        }
    };
}

// RBAC denials arrived as a plain Error, so `permission_denied` and
// `not_authenticated` were declared in the reason union and thrown nowhere: an
// agent could not tell "you lack permission" from a transport fault, and would
// retry a call that will never succeed. Mapped here, at the one place an RPC
// failure crosses into MCP.
const PERMISSION_DENIED_CODE = 1001;
const UNAUTHORIZED_CODE = -32000;

// Validation failures name their fields under `details`; form errors under
// `fieldErrors`. Either way the agent should learn which field to fix.
function fieldErrorsOf(error: RpcErrorEnvelope): unknown[] | undefined {
    const list = error.data?.fieldErrors ?? error.data?.details;
    return Array.isArray(list) && list.length > 0 ? list : undefined;
}

export function rpcErrorToMcpError(
    error: RpcErrorEnvelope,
    method: string
): Error {
    if (error.code === PERMISSION_DENIED_CODE) {
        return new McpError('permission_denied', error.message, {
            method,
            retryable: false
        });
    }
    if (error.code === UNAUTHORIZED_CODE) {
        return new McpError('not_authenticated', error.message, {
            method,
            retryable: false
        });
    }
    const fieldErrors = fieldErrorsOf(error);
    if (fieldErrors) {
        return new McpError('invalid_params', error.message, {
            method,
            retryable: false,
            details: {fieldErrors}
        });
    }
    const err = new Error(error.message) as Error & {code: number};
    err.code = error.code;
    return err;
}

export async function runRpcAsUser(
    user: user_t,
    method: string,
    params: Record<string, unknown>
): Promise<unknown> {
    enforceRateLimit(user.username, method, user.organizationId ?? null);
    const captured: Captured = {};
    const msg: JsonRpcIncoming = {
        id: 0,
        src: 'FLEET_MANAGER',
        method,
        params
    };
    await messageHandler.handleInternalCommands(
        collectingSendable(captured),
        msg,
        user
    );
    if (captured.error) {
        throw rpcErrorToMcpError(captured.error, method);
    }
    return captured.result;
}
