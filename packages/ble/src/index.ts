import * as BLE from "./Bluetooth";
import PriorityQueue from "./PriorityQueue";
import * as WS from './WebSocket'; 
import log4js from 'log4js';
log4js.configure({
    appenders: {
        console: { type: 'console' }
    },
    categories: {
        default: { appenders: ['console'], level: 'all' }
    }
});
const logger = log4js.getLogger();
export const queue = new PriorityQueue();

queue.on(PriorityQueue.START, () => logger.info("Queue started"))
queue.on(PriorityQueue.STOP, () => logger.info("Queue stopped"))
queue.on(PriorityQueue.DEQUEUE, (res, err) => {
    if (err) {
        logger.error("dequeue error", err);
        return;
    }
})

BLE.on('device-info', WS.sendDiscovered);

async function scanLoop() {
    queue.enqueue(BLE.scan().then(BLE.scanDeviceInfo), {
        timeout: 30_000, callback: () => {
            logger.info("next scan after 60 seconds");
            setTimeout(() => {
                // ble.destroy();
                scanLoop().catch(console.error);
            }, 60_000);
        }
    });
}

async function main() {
    await BLE.init();

    const onShutdown = () => {
        logger.fatal("shutting down...");
        setTimeout(() => {
            logger.fatal("forcefully exiting with code 1");
            process.exit(1)
        }, 1000);
        WS.close();
        BLE.destroy();
    }

    process.on('SIGINT', onShutdown);
    process.on('SIGTERM', onShutdown);
    process.on('SIGHUP', onShutdown);
    process.on('SIGABRT', onShutdown);

    scanLoop().catch(console.error);
}

process
    .on('unhandledRejection', (err) => { logger.error('unhandledRejection', err) }) // do nothing
    .on('uncaughtException', (err) => { logger.error('uncaughtException', err) }) // do nothing


main().catch(console.error);