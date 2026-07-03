import {getLogger} from 'log4js';
import type WebSocket from 'ws';

const logger = getLogger('deviceSocketRpc');

const RPC_ID_MIN = 0x40000000;
const RPC_ID_MAX = 0x7ffffffe;
let nextRpcId = RPC_ID_MIN;

function takeRpcId(): number {
    const id = nextRpcId;
    nextRpcId = nextRpcId >= RPC_ID_MAX ? RPC_ID_MIN : nextRpcId + 1;
    return id;
}

export interface DeviceSocketRpcRequest {
    method: string;
    label: string;
    timeoutMs: number;
}

// Send one JSON-RPC request to a connected device over its raw socket and
// resolve its result (null on error, timeout, or a closed socket). The single
// primitive behind waiting-room enrichment and the operator probe.
export function sendRpcOverDeviceSocket(
    ws: WebSocket,
    request: DeviceSocketRpcRequest
): Promise<unknown | null> {
    if (ws.readyState !== ws.OPEN) return Promise.resolve(null);
    const id = takeRpcId();

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: unknown | null) => {
            if (settled) return;
            settled = true;
            ws.removeListener('message', onMessage);
            ws.removeListener('close', onClose);
            ws.removeListener('error', onClose);
            clearTimeout(timer);
            resolve(value);
        };

        const onMessage = (data: Buffer | string) => {
            let msg: {
                id?: number;
                error?: {message?: string};
                result?: unknown;
            };
            try {
                msg = JSON.parse(data.toString());
            } catch {
                return;
            }
            if (msg?.id !== id) return;
            if (msg.error) {
                logger.debug(
                    '%s for %s returned error: %s',
                    request.method,
                    request.label,
                    msg.error?.message ?? 'unknown'
                );
                finish(null);
                return;
            }
            finish(msg.result ?? null);
        };
        // Short-circuit on socket death so the listener clears promptly instead
        // of waiting out the full timeout.
        const onClose = () => finish(null);
        const timer = setTimeout(() => finish(null), request.timeoutMs);

        ws.on('message', onMessage);
        ws.once('close', onClose);
        ws.once('error', onClose);

        try {
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    src: 'FLEET_MANAGER',
                    method: request.method
                })
            );
        } catch (error) {
            logger.warn(
                'Failed to send %s for %s: %s',
                request.method,
                request.label,
                error
            );
            finish(null);
        }
    });
}
