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

// Stateless dispatcher; builds a per-call CommandSender from the user.
const messageHandler = new MessageHandler();

interface Captured {
    result?: unknown;
    error?: {code: number; message: string};
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
        const err = new Error(captured.error.message) as Error & {
            code: number;
        };
        err.code = captured.error.code;
        throw err;
    }
    return captured.result;
}
