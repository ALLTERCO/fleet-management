import WebSocket from "ws";
import log4js from 'log4js';
import ShellyDevice from "../../model/ShellyDevice";
const logger = log4js.getLogger('ws');

const PATH = "/client";
export const wss = new WebSocket.Server({ noServer: true });

wss.on('listening', () => {
    logger.info("started on path:[%s]", PATH);
});
wss.on('connection', () => {
    logger.info("connection on path:[%s]", PATH);
});
wss.on('close', () => {
    logger.info("closed connection on path:[%s]", PATH);
});
wss.on('error', () => {
    logger.info("closed error on path:[%s]", PATH);
})

function notifyAll(msg: string) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        } 
    })
}

export function emitConnectEvent(device: ShellyDevice){
    const { shellyID, lastStatus, lastStatusTs, deviceInfo, source, channels, fields } = device;
    notifyAll(JSON.stringify({ event: 'Shelly:Connect', shellyID, lastStatus, lastStatusTs, deviceInfo, source, channels, fields }))
}

export function emitDisconnectEvent(device: ShellyDevice){
    const { shellyID } = device;
    notifyAll(JSON.stringify({ event: 'Shelly:Disconnect', shellyID}))
}

export function emitMessageEvent(shellyID: string, message: any){
    notifyAll(JSON.stringify({
        event: 'Shelly:Message',
        shellyID,
        message
    }))
}

export function emitFieldChanged(shellyID: string, name: string, field: string, value: string) {
    notifyAll(JSON.stringify({
        event: 'Field:Changed',
        shellyID,
        name,
        field,
        value
    }))
}