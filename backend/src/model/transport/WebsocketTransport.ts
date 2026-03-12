import type WebSocket from 'ws';
import RpcTransport from './RpcTransport';
export default class WebSocketTransport extends RpcTransport {
    public override name = 'ws';
    #ws: WebSocket;

    constructor(ws: WebSocket) {
        super();
        this.#ws = ws;
        // Attach transport reference so the heartbeat can check pending RPCs
        (ws as any).__rpcTransport = this;
        ws.on('close', () => {
            this._eventEmitter.emit('close');
        });
        ws.on('error', (e) => {
            this._eventEmitter.emit('err', e);
        });
        ws.on('message', (message: any) => {
            this.parseMessage(message);
        });
    }

    protected _sendRPC(params: string) {
        this.#ws.send(params);
    }

    public override destroy(): void {
        super.destroy();
        this.#ws.close();
    }
}
