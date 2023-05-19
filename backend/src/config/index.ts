import * as fs from 'fs';
import log4js from 'log4js';
const logger = log4js.getLogger();
import assert from "assert";
import path from 'path';

const CONFIG_FILE = process.env['CONFIG_FILE'] || path.join(__dirname, '../../configuration.json');

export const CFG_FOLDER = process.env['CONFIG_FOLDER'] || path.join(__dirname, "../../cfg");

const PATHS = {
    DEVICES: path.join(CFG_FOLDER, "devices.json"),
    MAIN: path.join(CFG_FOLDER, "main.json"),
    DEFAULT_RPC: path.join(CFG_FOLDER, "default_rpc.json"),
}

interface device_config_t {
    embedded: string[]
}

interface main_config_t {
    port: number,
    port_ssl: number,
    https_crt: string,
    https_key: string,
    jwt_token: string,
}

// Validators

function is_main_config(config: any): config is main_config_t {
    return typeof config === 'object'
        && typeof config.port === 'number'
        && typeof config.port_ssl === 'number'
        && typeof config.https_crt === 'string'
        && typeof config.https_key === 'string'
        && typeof config.jwt_token === 'string'
}

function is_device_config(config: any): config is device_config_t {
    return typeof config === 'object'
        && Array.isArray(config.embedded)
        && config.embedded.every((dev: any) => typeof dev === 'string')
}

function readConfigOrDie(path: string) {
    try {
        return JSON.parse(fs.readFileSync(path, 'utf-8'));
    } catch (error) {
        logger.fatal("failed to load config. Exiting with code 1. path=[%s] err=[%s]", CONFIG_FILE, error)
        process.exit(1);
    }
}

export const DEVICES_CONFIG: device_config_t = readConfigOrDie(PATHS.DEVICES);
if (!is_device_config(DEVICES_CONFIG)) {
    logger.fatal("Invalid devices config file format");
    process.exit(2);
}

export const MAIN_CONFIG: main_config_t = readConfigOrDie(PATHS.MAIN);
if (!is_main_config(MAIN_CONFIG)) {
    logger.fatal("Invalid main config file format");
    process.exit(2);
}

// replace some cfg variables with env variables
if (typeof process.env['FLEET_MANAGER_PORT'] === 'string') {
    const FLEET_MANAGER_PORT = Number(process.env['FLEET_MANAGER_PORT']);
    if (isFinite(FLEET_MANAGER_PORT)) {
        MAIN_CONFIG.port = FLEET_MANAGER_PORT;
    }
}

if (typeof process.env['FLEET_MANAGER_PORT_SSL'] === 'string') {
    const FLEET_MANAGER_PORT_SSL = Number(process.env['FLEET_MANAGER_PORT_SSL']);
    if (isFinite(FLEET_MANAGER_PORT_SSL)) {
        MAIN_CONFIG.port_ssl = FLEET_MANAGER_PORT_SSL;
    }
}

if (typeof process.env['FLEET_MANAGER_HTTPS_CRT'] === 'string') {
    MAIN_CONFIG.https_crt = process.env['FLEET_MANAGER_HTTPS_CRT'];
}

if (typeof process.env['FLEET_MANAGER_HTTPS_KEY'] === 'string') {
    MAIN_CONFIG.https_key = process.env['FLEET_MANAGER_HTTPS_KEY'];
}

export const DEFAULT_RPC: object = readConfigOrDie(PATHS.DEFAULT_RPC);

try {
    assert(MAIN_CONFIG.port > -1 || MAIN_CONFIG.port_ssl > -1, "At least one HTTP/HTTPS port must be specified");
    if (MAIN_CONFIG.port_ssl > -1) {
        assert(MAIN_CONFIG.https_crt.length > 0, 'https_crt not set');
        assert(MAIN_CONFIG.https_key.length > 0, 'https_crt not set');
    }
} catch (err: any) {
    logger.fatal("Wrong configuration. Exiting with code 1. err=[%s]", err.message);
    process.exit(1);
}
