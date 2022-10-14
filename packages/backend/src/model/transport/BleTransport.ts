import Transport from "./Transport";
import WebSocket from "ws";

export default class BleTransport extends Transport {

    private _socket: WebSocket;
    public readonly mac: string;
    private readonly shellyID: string;

    constructor(socket: WebSocket, mac: string, shellyID: string){
        super();
        this._socket = socket;
        this.mac = mac;
        this.shellyID = shellyID;
        this._socket.on('close', () => {
            super.emit('close')
        })
    }

    protected _sendRPC(params: string): void {
        const packet = JSON.stringify({
            method: 'rpc',
            mac: this.mac,
            params
        });
        this._socket.send(packet)
    }

    public send(params: string){
        this._socket.send(params)
    }

    public destroy(): void {
        
    }

}