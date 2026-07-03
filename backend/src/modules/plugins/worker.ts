import * as fs from 'node:fs';
import path from 'node:path';
import {isMainThread, parentPort, workerData} from 'node:worker_threads';
import {tuning} from '../../config';
import type {
    event_data_t,
    FleetManagerPlugin,
    json_rpc_event,
    PluginData
} from '../../types';
import {validateIpcFrame} from './ipcFrame';
import {settlePluginCallResponse} from './workerResponses';

if (isMainThread) {
    console.warn('Somehow the plugin worker is in the main thread');
    process.exit(-1);
}

function unhandledError(error: Error) {
    console.error('Plugins Uncaught Error err=[%s]', String(error));
    console.error(error);
}

process.on('uncaughtException', unhandledError);
process.on('unhandledRejection', unhandledError);

interface define_component_t {
    name: string;
    methods: Map<string, (params: any, sender: any) => Promise<any>>;
}

const pluginData: PluginData & {pluginsFolder?: string} = workerData;
let plugin: FleetManagerPlugin;

let waiting_id = 0;
const waiting: Map<
    number,
    {resolve: (r?: any) => any; reject: (r?: any) => any}
> = new Map();

const components: Map<string, define_component_t> = new Map();

function call(method: string, params?: any): Promise<any> {
    parentPort?.postMessage(['call_commander', waiting_id, method, params]);
    return new Promise((resolve, reject) => {
        waiting.set(waiting_id, {resolve, reject});
        waiting_id = waiting_id + 1;
    });
}

function defineComponent(component: define_component_t) {
    parentPort?.postMessage([
        'register_component',
        component.name,
        ...Array.from(component.methods.keys())
    ]);
    components.set(component.name, component);
}

async function commandCalled(others: any[]) {
    const [id, command, method, params, sender] = others;
    if (components.has(command)) {
        const component = components.get(command)!;
        if (component.methods.has(method)) {
            const methodCb = component.methods.get(method)!;
            try {
                const res = await methodCb(params, sender);
                parentPort?.postMessage([
                    'command_response',
                    id,
                    'resolve',
                    res
                ]);
            } catch (err) {
                parentPort?.postMessage([
                    'command_response',
                    id,
                    'reject',
                    err
                ]);
            }
            return;
        }
    }
    parentPort?.postMessage([
        'command_response',
        id,
        'reject',
        {error: 'not found'}
    ]);
}

function commanderResponse(others: any[]) {
    const [id, response_type, data] = others;
    settlePluginCallResponse(waiting, id, response_type, data);
}

async function addMetadata(
    event: json_rpc_event,
    additional: event_data_t,
    id: number
) {
    if (typeof plugin.addMetadata === 'function') {
        const response = await plugin.addMetadata(event, additional);
        parentPort?.postMessage(['add_metadata', id, response]);
    }
}

parentPort?.on('message', async (args) => {
    const v = validateIpcFrame(args, tuning.plugin.ipcMaxBytes);
    if (!v.ok) {
        if (typeof v.idForReject === 'number') {
            parentPort?.postMessage([
                'command_response',
                v.idForReject,
                'reject',
                {reason: v.reason}
            ]);
        }
        console.warn('plugin worker rejected ipc frame: %s', v.reason);
        return;
    }
    const {method, others} = v;
    switch (method) {
        case 'load': {
            const additionalNodeModulesPath = path.join(
                pluginData.location,
                'node_modules'
            );
            if (fs.existsSync(additionalNodeModulesPath)) {
                module.paths.push(additionalNodeModulesPath);
            }

            const resolvedLocation = path.resolve(pluginData.location);
            if (!pluginData.pluginsFolder) {
                parentPort?.postMessage([
                    'load_error',
                    'pluginsFolder not provided'
                ]);
                return;
            }
            const resolvedPlugins = path.resolve(pluginData.pluginsFolder);
            if (
                !resolvedLocation.startsWith(resolvedPlugins + path.sep) &&
                resolvedLocation !== resolvedPlugins
            ) {
                parentPort?.postMessage([
                    'load_error',
                    `Plugin location outside plugins folder: ${resolvedLocation}`
                ]);
                return;
            }
            plugin = require(resolvedLocation) as FleetManagerPlugin;

            if (typeof plugin.load === 'function') {
                plugin.load({call, defineComponent});
            }

            parentPort?.postMessage(['load']);
            break;
        }
        case 'unload':
            if (typeof plugin.unload === 'function') {
                plugin.unload();
            }
            parentPort?.postMessage(['unload']);
            break;
        case 'on':
            if (typeof plugin.on === 'function') {
                plugin.on(
                    others[0] as json_rpc_event,
                    others[1] as event_data_t
                );
            }
            break;

        case 'add_metadata':
            addMetadata(
                others[0] as json_rpc_event,
                others[1] as event_data_t,
                others[2] as number
            );
            break;

        case 'command_called':
            commandCalled(others);
            break;

        case 'commander_response':
            commanderResponse(others);
            break;
    }
});
