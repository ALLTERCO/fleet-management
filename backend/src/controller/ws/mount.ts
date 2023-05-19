import WebSocket from "ws";
import log4js from 'log4js';
import * as DeviceManager from "../../DeviceManager";
const logger = log4js.getLogger('mount');

const PATH = "/mount";
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

wss.on('connection', (ws, request) => {
    const shellyID = String(request.headers['shellyID']);
    const shelly = DeviceManager.getDevice(shellyID);
    if (shelly == undefined) {
        logger.warn("no shelly found for shellyID:[%s] closing the ws mount connection", shellyID)
        ws.close();
        return;
    }

    ws.on("message", (data) => {
        try {
            const msg = JSON.parse(data.toString())
            shelly.sendUnsafe(msg)
        } catch (error) {
            logger.error("Cannor parse ws message", data.toString())
        }
    })

    shelly.on('message', (message: ShellyMessageIncoming) => {
        const result = JSON.stringify(message);
        if(result == undefined || ws.readyState != ws.OPEN) return;
        ws.send(result, err => {
            if (err) {
                logger.error("error forwading message:[%s] err:[%s]", result, String(err), err)
                return;
            }
        });
    })
    
    shelly.on('close', () => {
        logger.info("shellyID:[%s] closed connection. Closing mounted ws", shellyID);
        ws.close();
    })
})