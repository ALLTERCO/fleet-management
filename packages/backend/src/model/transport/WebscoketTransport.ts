import Transport from "./Transport";
import { WebSocket } from "ws";

export default class WebSocketTransport extends Transport {
    private _ws: WebSocket;

    constructor(ws: WebSocket){
        super();
        this._ws = ws;
        ws.on('message', (message: any) => {
            const parsed = this.parseMessage(message);
            if(parsed == undefined){
                console.error("failed to parse message", message);
                return;
            }
        });
        ws.on('close', () => {
            super.emit('close')
        })
    }

    protected _sendRPC(params: string) {
        this._ws.send(params);
    }

    public destroy(): void {
        this._ws.close();
    }
}