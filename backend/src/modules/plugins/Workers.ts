import path from 'node:path';
import {Worker} from 'node:worker_threads';
import CommandSender from '../../model/CommandSender';
import PluginGeneratedComponent from '../../model/component/PluginGeneratedComponent';
import type {PluginData} from '../../types';
import * as Commander from '../Commander';
import * as Observability from '../Observability';
import PluginNotifier from './PluginNotifier';

export default class Workers {
    private static readonly pluginWorkers = new Map<string, Worker>();

    public static createWorker(pluginData: PluginData) {
        // Register plugin worker w/ events
        const worker = new Worker(path.join(__dirname, 'worker.js'), {
            workerData: pluginData
        });

        let commandId = 0;
        const waiting: Map<
            number,
            {resolve: (r?: any) => any; reject: (r?: any) => any}
        > = new Map();
        worker.on('message', async (args) => {
            const [method, ...params] = args;
            switch (method) {
                case 'load':
                    Workers.pluginWorkers.set(pluginData.info.name, worker);
                    PluginNotifier.invalidateMetadataHandlersCache();
                    break;
                case 'unload':
                    Workers.pluginWorkers.delete(pluginData.info.name);
                    PluginNotifier.invalidateMetadataHandlersCache();
                    break;

                case 'register_component': {
                    const [name, ...methods] = params;

                    const methodsMap: Map<
                        string,
                        (params: any, sender: any) => Promise<any>
                    > = new Map();
                    for (const method of methods) {
                        methodsMap.set(
                            method,
                            (params, sender) =>
                                new Promise((resolve, reject) => {
                                    sender.additional = undefined; // not serializable
                                    const safeSender = {
                                        group: sender.group,
                                        permissions: Array.from(
                                            sender.permissions || []
                                        ) // convert Set to array
                                    };
                                    console.log(
                                        'plugin forwarding',
                                        name,
                                        method,
                                        params,
                                        sender
                                    );
                                    worker.postMessage([
                                        'command_called',
                                        commandId,
                                        name,
                                        method,
                                        params,
                                        safeSender
                                    ]);
                                    waiting.set(commandId, {resolve, reject});
                                    commandId++;
                                })
                        );
                    }

                    const component = new PluginGeneratedComponent(
                        name,
                        methodsMap,
                        pluginData.info.name
                    );
                    Commander.registerComponent(component);
                    break;
                }

                case 'command_response': {
                    const [id, response_type, data] = params;
                    const {resolve, reject} = waiting.get(id)!;
                    if (response_type === 'resolve') {
                        resolve(data);
                    } else {
                        reject(data);
                    }
                    break;
                }

                case 'call_commander': {
                    const [call_id, method, pass_params] = params;
                    try {
                        const res = await Commander.exec(
                            CommandSender.PLUGIN,
                            method,
                            pass_params
                        );
                        worker.postMessage([
                            'commander_response',
                            call_id,
                            'resolve',
                            res
                        ]);
                    } catch (err) {
                        worker.postMessage([
                            'commander_response',
                            call_id,
                            'reject',
                            err
                        ]);
                    }
                    break;
                }
                case 'add_metadata': {
                    const [metadata_id, metadata] = params;
                    PluginNotifier.addMetadataFromPlugin(metadata_id, metadata);
                    break;
                }
            }
        });

        worker.on('error', () => {
            Observability.incrementCounter('plugin_worker_errors');
        });

        worker.on('exit', (code) => {
            if (code !== 0)
                Observability.incrementCounter('plugin_worker_crashes');
        });

        // Send load signal AFTER message handler is registered
        // to avoid race condition where worker responds before we're listening
        worker.postMessage(['load']);
    }

    public static getPluginWorkers() {
        return Workers.pluginWorkers;
    }
}

Observability.registerModule('pluginWorkers', () => ({
    activeWorkers: Workers.getPluginWorkers().size
}));
