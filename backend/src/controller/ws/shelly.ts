import WebSocket from "ws";
import log4js from 'log4js';
const logger = log4js.getLogger('ws');
import * as DeviceManager from '../../DeviceManager';
import { MAIN_CONFIG } from '../../config';
import WebSocketTransport from "../../model/transport/WebsocketTransport";
import ShellyDevice from "../../model/ShellyDevice";

export const wss = new WebSocket.Server({ noServer: true });

const PATH = '/shelly';

wss.on('connection', (ws) => {
    ws.on('message', async (message: any) => {
        try {
            message = JSON.parse(message);
        } catch (error) {
            logger.warn("Cannot parse message on /shelly");
            ws.close(4001);
            return;
        }

        if (typeof message !== 'object' || typeof message.method !== 'string' || typeof message.src !== 'string') {
            logger.warn("bad message on /shelly msg:[%s]", JSON.stringify(message));
            ws.close(4002);
            return;
        }

        if (message.method == 'NotifyFullStatus') {
            const deviceMAC = message.params?.sys?.mac?.toLowerCase();
            const shellyID = message.src;

            if (shellyID == undefined || deviceMAC == undefined) {
                logger.warn("unparseable shellyID/deviceMAC in 'NotifyFullStatus' on /shelly", message);
                ws.close(4003);
                return;
            }

            ws.removeAllListeners();
            ws.on('close', () => {
                const shelly = DeviceManager.getDevice(shellyID);
                if (shelly) {
                    shelly.emitter.emit('close');
                }
            })

            const found = DeviceManager.getDevice(shellyID);
            if (found == undefined) {
                logger.info('Registering new websocket client for shellyID:[%s] mac:[%s]', shellyID, deviceMAC);
                const shelly = new ShellyDevice(shellyID, {
                    transport: new WebSocketTransport(ws),
                    source: 'ws'
                });
                shelly.status = message.params;
                DeviceManager.register(shelly);
            } else {
                logger.info('There is already existing websocket connection for this device. Replacing websocket. shellyID:[%s]', shellyID);
                found.setTransport(new WebSocketTransport(ws));
                found.status = message.params;
            }
        }
    });

})

wss.on('listening', () => {
    logger.info("listening on path:[%s] port:[%s]", PATH, MAIN_CONFIG.port);
});