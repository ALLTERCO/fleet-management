import JSONDriver from './JSONDriver';
import SQLiteDriver from './SQLiteDriver';
import * as path from 'path';
import * as fs from 'fs';
import Driver from './Driver';

// BEGIN: TYPES
interface component_t {
    name: string,
    methods: Map<string, (params: any, sender: any) => Promise<any>>
}

interface json_rpc_event_t {
    method: string,
    params: Record<string, any>
}

interface config_t {
    driver: string,
    path: string,

}
const CONFIG_FILE_PATH = path.join(__dirname, "./config.json");

const DEFAULT_CONFIG: config_t = {
    driver: "JSON",
    path: ''

}
export type event_data_t = { shelly?: ShellyDeviceExternal };

interface ShellyDeviceExternal {
    shellyID: string,
    source: string,
    info: any,
    status: any,
    settings: any,
}

type define_component_t = (component: component_t) => void;

// END: TYPES

let plugin: Driver;
let config = loadConfig();

export function load({defineComponent}: {defineComponent: define_component_t}) {
    defineComponent({
        name: 'group',
        methods: map
    });
    console.log("Metadata Demo Plugin loaded");
    switch (config.driver) {
        case 'JSON':
            plugin = new JSONDriver();
            break;
        case "SQLite":
            plugin = new SQLiteDriver(config.path);
            break;
        default:
            console.error('Invalid driver selected');
    }
}

export function unload() {
    console.log("Metadata Demo Plugin Unloaded")
    switch (config.driver) {
        case 'JSON':
            break;
        case "SQLite":
            plugin.close();
            break;
        default:
            console.error('Invalid driver selected');
            break;
    }
}

export function addMetadata(event: json_rpc_event_t, additional: event_data_t) {
    if (additional.shelly?.info?.id) {
        return plugin.enrichJSON(additional.shelly?.info?.id);
    }
    return undefined;
}

function is_config(config: any): config is config_t {
    return typeof config === 'object'
        && typeof config.driver === 'string'
        && typeof config.path === 'string'

}
function saveConfig(driver: string, path: string) {
    let invalid = false;
    switch (driver) {
        case 'JSON':
            plugin = new JSONDriver();
            break;
        case "SQLite":
            plugin = new SQLiteDriver(path);
            break;
        default:
            console.error('Invalid driver selected - ' + driver);
            invalid = true;
            break;
    }
    if (!invalid) {
        // Do not write invalid data into the config
        fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify({ driver, path }), 'utf-8');
        config = loadConfig();
    }
}

function loadConfig() {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
        const saved = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(saved);
        if (is_config(parsed)) {
            return parsed;
        }
        // config is invalid, it will be overwriten
    }
    saveConfig(DEFAULT_CONFIG.driver, DEFAULT_CONFIG.path)
    return DEFAULT_CONFIG;
}

const map = new Map();
map.set('list', () => Promise.resolve(plugin.list()));
map.set('add', (params: any) => Promise.resolve(plugin.add(params.shellyID, new Set(params.groups.split(',')))));
map.set('remove', (params: any) => Promise.resolve(plugin.remove(params.shellyID, new Set(params.groups.split(',')))));
map.set('intersect', (params: any) => Promise.resolve(plugin.intersection(params.groups.split(','))));
map.set('create', (params: any) => Promise.resolve(plugin.create(params.name)));
map.set('delete', (params: any) => Promise.resolve(plugin.delete(params.name)));
map.set('rename', (params: any) => Promise.resolve(plugin.rename(params.name, params.newName)));
map.set('unite', (params: any) => Promise.resolve(plugin.union(params.groups.split(','))));
map.set('setconfig', (params: any) => Promise.resolve(saveConfig(params.driver, params.path)));
map.set('getconfig', (params: any) => Promise.resolve(loadConfig()));
