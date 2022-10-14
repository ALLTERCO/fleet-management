import * as http from "http";
import { wss as clientWss } from "./client";
import { wss as shellyWss } from "./shelly";
import { wss as bleWss } from "./ble";
import { parse } from 'url';

export default (server: http.Server) => {
    server.on('upgrade', function upgrade(request, socket, head) {
        if(request.url == undefined) return;
        const { pathname } = parse(request.url);

        if (pathname === '/client') {
            clientWss.handleUpgrade(request, socket, head, (ws) => {
                clientWss.emit('connection', ws, request);
            });
        } else if (pathname === '/shelly') {
            shellyWss.handleUpgrade(request, socket, head, (ws) => {
                shellyWss.emit('connection', ws, request);
            });
        } else if (pathname === '/ble') {
            bleWss.handleUpgrade(request, socket, head, (ws) => {
                bleWss.emit('connection', ws, request)
            })
        } else {
            socket.destroy();
        }
    });
}
