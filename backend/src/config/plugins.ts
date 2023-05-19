import path from 'path';
import fs from 'fs';
import log4js from 'log4js';
import { event_data_t } from '../EventManager';
const logger = log4js.getLogger('Plugin Loader');
import { Worker } from "worker_threads";
import Commander, { command_sender_t } from '../model/Commander';
import * as components from './components';
import PluginComponent from '../model/component/PluginComponent';

export const PLUGINS_FOLDER = process.env['CONFIG_FOLDER'] || path.join(__dirname, "../../plugins");

const pluginDataMap = new Map<string, PluginData>();
const plugins = new Map<string, Worker>();

const pluginCommandSender: command_sender_t = {
    permissions: ['*'],
    group: 'plugins'
}

function pluginRegistered(name: string) {
    for (const data of pluginDataMap.values()) {
        if (data.info.name == name) return true;
    }
    return false;
}

function isPluginInfo(pluginInfo: any): pluginInfo is PluginInfo {
    return typeof pluginInfo === 'object'
        && typeof pluginInfo.name === 'string'
        && typeof pluginInfo.version === 'string'
        && typeof pluginInfo.description === 'string'
}

export async function loadFromFolder() {
    if (fs.existsSync(PLUGINS_FOLDER)) {
        const dir = fs.readdirSync(PLUGINS_FOLDER)
        for (const entry of dir) {
            const pluginFolder = path.join(PLUGINS_FOLDER, entry);
            if (fs.lstatSync(pluginFolder).isDirectory()) {
                const packageJsonPath = path.join(pluginFolder, 'package.json');
                if (!fs.existsSync(packageJsonPath)) {
                    logger.warn(`Cannot find 'package.json' in '${pluginFolder}'. Ignoring plugin...`);
                    return;
                }

                const pluginInfo = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
                if (!isPluginInfo(pluginInfo)) {
                    logger.warn(`Invalid data format in 'package.json' in '${pluginFolder}'. Ignoring plugin...`);
                    return;
                }

                if(pluginInfo.name.startsWith("@")){
                    pluginInfo.name = pluginInfo.name.split("/").at(-1) || pluginInfo.name
                }

                if (pluginRegistered(pluginInfo.name)) {
                    logger.warn(`Plugin '${pluginInfo.name}' already loaded`);
                    return;
                }

                logger.mark("enabling plugin name:[%s] ver:[%s] desc:[%s]", pluginInfo.name, pluginInfo.version, pluginInfo.description);

                pluginDataMap.set(pluginInfo.name, {
                    location: pluginFolder,
                    info: pluginInfo,
                });

                const config = components.getConfigFor(`plugin:${pluginInfo.name}`, {});

                if(typeof config === 'object' && typeof config.enable === 'boolean' && config.enable){
                    enablePlugin(pluginInfo.name);
                }

                Commander.getInstance().registerComponent(new PluginComponent(pluginInfo.name));
            }
        }
    }
}

export function listPlugins() {
    return Object.fromEntries(pluginDataMap.entries());
}

export function enablePlugin(name: string) {
    if (!pluginDataMap.has(name)) {
        return false;
    }
    const pluginData = pluginDataMap.get(name)!;

    const worker = new Worker(__dirname + '/../controller/plugin/worker.js', { workerData: pluginData });

    worker.postMessage(['load']);

    let commandId = 0;
    const waiting: Map<number, { resolve: Function, reject: Function }> = new Map();
    worker.on('message', (args) => {
        const [method, ...params] = args;
        switch (method) {
            case 'load':
                plugins.set(pluginData.info.name, worker);
                break;
            case 'unload':
                plugins.delete(pluginData.info.name);
                break;

            case 'register_component':
                const [name, ...methods] = params;
                // console.log("register_component ", ...params);

                const methodsMap: Map<string, (params: any, sender: any) => Promise<any>> = new Map();
                for (const method of methods) {
                    methodsMap.set(method, (params, sender) => new Promise((resolve, reject) => {
                        delete sender.additional; // not serializable
                        // console.log('plugin forwarding', name, method, params, sender)
                        worker.postMessage(['command_called', commandId, name, method, params, sender]);
                        waiting.set(commandId, { resolve, reject });
                        commandId++;
                    }));
                }

                Commander.getInstance().registerComponentFromPlugin(name, methodsMap);
                break;

            case 'command_response':
                const [id, response_type, data] = params;
                // console.log({ id, response_type, data })
                const { resolve, reject } = waiting.get(id)!;
                if (response_type === 'resolve') {
                    resolve(data);
                } else {
                    reject(data);
                }
                break;

            case 'call_commander':
                const [call_id, method, pass_params] = params;
                // console.log("commander called", call_id, method, pass_params)
                Commander.getInstance().exec(pluginCommandSender, method, pass_params).then((res) => {
                    worker.postMessage(['commander_response', call_id, 'resolve', res]);
                    // console.log("commader_response", call_id, 'resolve', res)
                }, (err) => {
                    worker.postMessage(['commander_response', call_id, 'reject', err]);
                })
        }
    })
    return true;
}

export function disablePlugin(name: string) {
    if (!pluginDataMap.has(name)) {
        return false;
    }
    const pluginData = pluginDataMap.get(name)!;
    const pluginWorker = plugins.get(pluginData.info.name);

    if (pluginWorker == undefined) {
        return false;
    }

    pluginWorker.postMessage(['unload']);
    return true;
}

export function notifyEvent<T extends json_rpc_event>(event: T, eventData?: event_data_t) {
    for (const pluginWorker of plugins.values()) {
        pluginWorker.postMessage(['on', event, eventData]);
    }
}