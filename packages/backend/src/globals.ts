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
        web: {
            appenders: ['console', 'defaultFile'],
            level: "all"
        },
        ws: {
            appenders: ['console', 'defaultFile'],
            level: "all"
        }
    }
});
const logger = log4js.getLogger();
import assert from 'assert';
import * as fs from 'fs';
import "./database";
import ShellyDevice from "./model/ShellyDevice";
import * as clientWs from './controller/ws/client';

export const devices: Record<string, ShellyDevice> = {};

export function handleNewDevice(shelly: ShellyDevice) {
    const old = devices[shelly.shellyID];

    if (old != undefined) {
        if (old.source === 'ws' && shelly.source === 'ble') {
            // We have discovered something that is already connected
            shelly.destroy();
            return;
        }
        old.destroy();
    }
    devices[shelly.shellyID] = shelly;
}

export function deleteDevice(shelly: ShellyDevice){
    clientWs.emitDisconnectEvent(shelly);
    delete devices[shelly.shellyID];
}

export const PASSWORD = process.env['PASSWORD'] || "SHELLY";

export const WEB_PORT_HTTP = Number(process.env['WEB_PORT_HTTP']) || -1;
export const WEB_PORT_HTTPS = Number(process.env['WEB_PORT_HTTPS']) || -1;
export const HTTPS_CRT = process.env['HTTPS_CRT'] ? fs.readFileSync(process.env['HTTPS_CRT']) : "";
export const HTTPS_KEY = process.env['HTTPS_KEY'] ? fs.readFileSync(process.env['HTTPS_KEY']) : "";
export const DEFAULT_RPC = JSON.parse(fs.readFileSync('default_rpc.json', 'utf-8')) || [];

try {
    assert(WEB_PORT_HTTP > -1 || WEB_PORT_HTTPS > -1);
    if (WEB_PORT_HTTPS > -1) {
        assert(HTTPS_CRT.length > 0);
        assert(HTTPS_KEY.length > 0);
    }
} catch (err) {
    logger.fatal("Wrong configuration. At least one http port should be set. Exiting with code 1. err=[%s]", err);
    process.exit(1);
}