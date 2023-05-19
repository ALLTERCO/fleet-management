import dotenv from 'dotenv';
dotenv.config();
import * as log4js from "log4js";
log4js.configure({
    appenders: {
        console: { type: "console" },
        defaultFile: { type: "file", filename: "logs/default.log" }
    },
    categories: {
        default: {
            appenders: ['console', 'defaultFile'],
            level: "all"
        },
    }
});
const logger = log4js.getLogger();
import * as DeviceManager from './DeviceManager';

import './controller/mdns';
import Commander from './model/Commander';
Commander.getInstance();
import * as plugins from './config/plugins';
plugins.loadFromFolder(); // load asynchronously

process.on('unhandledRejection', (err: Error) => {
    logger.error('unhandledRejection', err.name, err);
}) // do nothing

process.on('uncaughtException', (err: Error) => { logger.error('uncaughtException', err.name, err) }) // do nothing
process.on('SIGINT', onShutdown);
process.on('SIGTERM', onShutdown);
process.on('SIGHUP', onShutdown);
process.on('SIGABRT', onShutdown);

function onShutdown() {
    logger.fatal("Shutting down...");
    DeviceManager.destroyAll();
    process.exit(0)
}

import './web';