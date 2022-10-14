import log4js from 'log4js';
const logger = log4js.getLogger('ws');
import WebSocket from "ws";
import { handleNewDevice } from '../../globals';
import ShellyDevice from '../../model/ShellyDevice';
import BleTransport from '../../model/transport/BleTransport';
import { devices } from "../../globals";

const PATH = "/ble";
export const wss = new WebSocket.Server({ noServer: true });

wss.on('listening', () => {
    logger.info("started on path:[%s]", PATH);
});
wss.on('connection', (socket) => {
    logger.info("connection on path:[%s]", PATH);
    socket.on("message", (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            if(parsed.event == undefined){
                logger.error("message without event", parsed);
                return;
            }

            switch(parsed.event) {
                case 'discovered':
                    const { shellyID, mac, data } = parsed;
                    handleNewDevice(new ShellyDevice(shellyID, {
                        transport: new BleTransport(socket, mac, shellyID),
                        source: 'ble',
                        deviceInfo: data
                    }));
                    break;
                case 'rpc':
                    if(parsed.src){
                        const device = devices[parsed.src];
                        if(device == undefined){
                            console.warn('ble rpc device not found ', device)
                            return;
                        } 
                        device.transport.parseMessage(JSON.stringify(parsed))
                        delete parsed.src;
                    } else {
                        console.warn('ble rpc bad message', parsed)
                    }
                    // TODO
                    break;
                case 'provision':
                    logger.debug("provision", parsed);
                    break;
            }

            
        } catch (error) {
            logger.error("failed to parse ble message", error)
        }
    });
});
wss.on('close', () => {
    logger.info("closed connection on path:[%s]", PATH);
});
wss.on('error', () => {
    logger.info("closed error on path:[%s]", PATH);
})