import { devices } from '../globals';
import { History } from "../database";
import * as log4js from 'log4js';
import ShellyDevice from '../model/ShellyDevice';
const logger = log4js.getLogger();

const IGNORE_CONFIG = ['ws', 'sys'];

export async function call(shellyID: string, method: string, params?: any) {
    logger.debug("Preparing rpc call shellyID:[%s] method:[%s] params:[%s]", shellyID, method, JSON.stringify(params))
    const shelly = devices[shellyID];
    if (!shelly) {
        logger.error(`Shelly '${shellyID}' not connected`);
        throw new Error(`Shelly '${shellyID}' not connected`);
    }
    let result = {} as any;
    if (method == 'Custom.ApplyConfig') {
        result = await applyConfig(shelly, params);
    } else if (method == 'Custom.MultiCall') {
        result = await multiCall(shelly, params);
    } else {
        result = await shelly.shellyRPC(method, params);
    }

    History.create({
        shellyID,
        request: { 
            method,
            params
        },
        response: result,
        timestamp: Date.now()
    })
    return result;
}

async function multiCall(shelly: ShellyDevice, params: any): Promise<{ [key: string]: any }> {
    logger.debug('multiCall params', JSON.stringify(params, undefined, 4))
    let result: Record<string, any> = {};
    for (const key in params) {
        result[key] = await shelly.shellyRPC(key, params[key]);
    }
    return result;
}

async function applyConfig(target: ShellyDevice, sourceConfig: any) {
    const multicall: Record<string, any> = {};
    for (let key in sourceConfig) {
        if (IGNORE_CONFIG.includes(key)) continue;
        if (key.includes(":")) {
            key = key.substring(0, key.indexOf(":"))
        }
        multicall[key + '.SetConfig'] = { config: sourceConfig[key] };
    }
    return multiCall(target, multicall);
}