import type WebSocket from 'ws';
import RpcTransport from './RpcTransport';

export default class WebSocketTransport extends RpcTransport {
    public override name = 'ws';
    #ws: WebSocket;
    #torn = false;
    // Named so tearDown can detach exactly these — the socket is co-owned.
    #onClose = () => this.#tearDown();
    #onError = (e: unknown) => this._eventEmitter.emit('err', e);
    #onMessage = (m: unknown) => this.parseMessage(m);

    constructor(ws: WebSocket) {
        super();
        this.#ws = ws;
        // Heartbeat probes pending RPCs through this back-reference.
        (ws as any).__rpcTransport = this;
        // Whichever fires first (network drop or upstream destroy()) routes
        // through the same idempotent tearDown — pending RPCs reject
        // immediately instead of hanging until the 10s sweep, and the ws
        // listeners are released so the transport can be GC'd.
        ws.on('close', this.#onClose);
        ws.on('error', this.#onError);
        ws.on('message', this.#onMessage);
    }

    protected _sendRPC(params: string) {
        this.#ws.send(params);
    }

    public override destroy(): void {
        this.#tearDown();
    }

    #tearDown(): void {
        if (this.#torn) return;
        this.#torn = true;
        super.destroy();
        this._eventEmitter.emit('close');
        // Detach only our listeners — removeAllListeners() would strip a
        // co-owner's close handler (ingress registry cleanup) and leak it.
        this.#ws.removeListener('close', this.#onClose);
        this.#ws.removeListener('error', this.#onError);
        this.#ws.removeListener('message', this.#onMessage);
        this.#ws.close();
    }
}
