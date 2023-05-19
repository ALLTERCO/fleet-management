import Transport from "./Transport";
import { WebSocket } from "ws";

export default class WebSocketTransport extends Transport {
    #ws: WebSocket;

    constructor(ws: WebSocket) {
        super();
        this.#ws = ws;
        ws.on('message', (message: any) => {
            this.parseMessage(message);
        });
    }

    protected _sendRPC(params: string) {
        this.#ws.send(params);
    }

    public destroy(): void {
        if (this.#ws.readyState == WebSocket.OPEN || this.#ws.readyState == WebSocket.CONNECTING) {
            this.#ws.close();
        }
    }
}