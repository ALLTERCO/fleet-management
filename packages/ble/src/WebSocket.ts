import log4js from 'log4js';
const logger = log4js.getLogger("websocket");
import { queue } from '.';
import * as BLE from "./Bluetooth";

import WebSocket from 'ws';
const BACKEND_URI = process.env['BACKEND_URI'] || 'ws://localhost/ble';

let ws: WebSocket;

export function sendDiscovered(shellyID: string, mac: string, data: any) {
    ws.send(JSON.stringify({ event: 'discovered', shellyID, mac, data }));
}

export function close() {
    if (ws != undefined) {
        ws.close();
    }
}

function handleWsMessage(message: any) {
    logger.debug('received', Buffer.from(message).toString())
    try {
        const parsed = JSON.parse(Buffer.from(message).toString());
        if (parsed.method == undefined) {
            logger.error("Error pasring message from backend. No method", parsed)
            return;
        }

        switch (parsed.method) {
            case 'rpc':
                queue.enqueue(
                    BLE.shellyRPC(parsed.mac, parsed.params).then((res: any) => {
                        if (res != undefined && typeof res === 'string') {
                            const toSend = JSON.stringify({
                                event: 'rpc',
                                ...JSON.parse(res)
                            });
                            logger.fatal("ws sending", toSend)
                            ws.send(toSend)
                        }
                    }),
                    { timeout: 10_000, priority: 10 }
                );
                break;

            case 'provision':
                BLE.provision(parsed.mac, parsed.params.wsServer, parsed.params.wifi).then(res => {
                    ws.send(JSON.stringify({
                        event: 'provision',
                        ...res
                    }))
                })
                break;
        }

    } catch (error) {
        logger.error("Error pasring message from backend")
    }
}

let socketReconnect = true;

function createWebsocket() {
    return new Promise<void>((resolve, reject) => {
        ws = new WebSocket(BACKEND_URI);
        ws.on('open', () => {
            socketReconnect = false;
            logger.info("ws connected");
            const devices = BLE.getDevices();
            for(const id in devices){
                const device = devices[id];
                if(device.deviceInfo != undefined){
                    logger.debug("ws sending for " + device.name)
                    sendDiscovered(device.name, id, device.deviceInfo);
                }
            }
            resolve();
        });
        ws.on('close', async () => {
            socketReconnect = true;
            reject();
        });
        ws.on('error', (err) => {
            socketReconnect = true;
            reject();
        })
        ws.on('message', handleWsMessage)
    })
}

async function reconnect() {
    try {
        await createWebsocket()
    } catch (err) {
        logger.error('WEBSOCKET_RECONNECT: Error', new Error(err).message)
    }
}

setInterval(() => {
    if (socketReconnect) {
        reconnect()
    }
}, 5000);

reconnect();