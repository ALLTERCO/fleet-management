import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import RpcTransport from './RpcTransport';

const logger = log4js.getLogger();

export default class HttpTransport extends RpcTransport {
    public override name = 'local';
    #deviceIp: string;

    constructor(deviceIp: string) {
        super();
        this.#deviceIp = deviceIp;
    }

    protected async _sendRPC(params: string): Promise<void> {
        try {
            const res: Response = await fetch(`http://${this.#deviceIp}/rpc`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: params,
                // Close the socket when the RPC sweep gives up; without
                // this a silent device holds it until the OS timeout.
                signal: AbortSignal.timeout(tuning.rpc.rpcTimeoutMs)
            });
            if (!res.ok) {
                throw new Error(`StatusCode:${res.status}`);
            }
            const message = await res.json();
            logger.debug('httpTransport sendRPC message[%s]', message);
            this.parseMessage(JSON.stringify(message));
        } catch (error: any) {
            logger.error(
                'Failed to send rpc to ip=[%s]',
                this.#deviceIp,
                error.message
            );
            this._eventEmitter.emit('err', error);
            // Tag with the request id so parseMessage rejects the waiting
            // promise now, instead of hanging until the stale-sweep.
            const reqId = requestId(params);
            this.parseMessage(
                JSON.stringify(RpcError.DeviceNotFound().getRpcError(reqId))
            );
        }
    }
}

// Read the JSON-RPC id back out of an outgoing request frame.
function requestId(serialized: string): number | undefined {
    try {
        const id = JSON.parse(serialized)?.id;
        return typeof id === 'number' ? id : undefined;
    } catch {
        return undefined;
    }
}
