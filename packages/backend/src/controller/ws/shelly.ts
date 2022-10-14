import WebSocket from "ws";
import log4js from 'log4js';
const logger = log4js.getLogger('ws');
import { WEB_PORT_HTTP, handleNewDevice, devices } from '../../globals';
import WebSocketTransport from "../../model/transport/WebscoketTransport";
import ShellyDevice from "../../model/ShellyDevice";

export const wss = new WebSocket.Server({ noServer: true });

const PATH = '/shelly';

wss.on('connection', (ws) => {
    ws.on('message', async (message: any) => {
        message = JSON.parse(message);
        // logger.debug(message)
        if (message.method == 'NotifyFullStatus') {
            const shellyID = message.params.sys.mac.toLowerCase();
            const found = devices[shellyID];
            if (found == undefined) {
                logger.info('Registering new websocket client for id:[%s]', shellyID);
                const device = new ShellyDevice(shellyID, {
                    transport: new WebSocketTransport(ws),
                    source: 'ws'
                });
                device.status = message.params;
                handleNewDevice(device);
            } else {
                logger.info('There is already existing websocket connection for this device. Replacing. shellyID:[%s]', shellyID);
                found.setTransport(new WebSocketTransport(ws));
                found.status = message.params;
            }
        }
    })
})

wss.on('listening', () => {
    logger.info("listening on path:[%s] port:[%s]", PATH, WEB_PORT_HTTP);
});