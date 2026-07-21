import path from 'node:path';
import {Worker} from 'node:worker_threads';
import * as log4js from 'log4js';
import {PLUGINS_FOLDER, tuning} from '../../config';
import CommandSender from '../../model/CommandSender';
import PluginGeneratedComponent from '../../model/component/PluginGeneratedComponent';
import type {PluginData} from '../../types';
import * as Commander from '../Commander';
import * as Observability from '../Observability';
import {guardListener} from '../util/faultGuard';
import PluginNotifier from './PluginNotifier';
import {isMethodAllowed} from './rpcAllowlist';
import {
    hasPluginWorkerCapacity,
    pluginWorkerResourceLimits
} from './workerLimits';

const logger = log4js.getLogger('PluginWorkers');

interface PendingCommand {
    resolve: (r?: any) => any;
    reject: (r?: any) => any;
    timer: ReturnType<typeof setTimeout>;
}

export default class Workers {
    private static readonly pluginWorkers = new Map<string, Worker>();
    private static readonly startingWorkers = new Set<string>();
    private static readonly generatedComponentsByPlugin = new Map<
        string,
        Set<string>
    >();

    private static unregisterGeneratedComponents(pluginName: string): void {
        const names = Workers.generatedComponentsByPlugin.get(pluginName);
        if (!names) return;
        for (const name of names) {
            Commander.unregisterComponent(name);
        }
        Workers.generatedComponentsByPlugin.delete(pluginName);
    }

    private static isRpcAllowed(
        pluginData: PluginData,
        method: string
    ): boolean {
        const configured =
            pluginData.info.config?.rpcAllowlist ??
            pluginData.info.config?.allowedRpcMethods;
        return isMethodAllowed(configured, method);
    }

    public static createWorker(pluginData: PluginData) {
        const pluginName = pluginData.info.name;
        if (
            Workers.pluginWorkers.has(pluginName) ||
            Workers.startingWorkers.has(pluginName)
        ) {
            return;
        }
        if (
            !hasPluginWorkerCapacity(
                Workers.pluginWorkers.size,
                Workers.startingWorkers.size,
                tuning.plugin.maxWorkers
            )
        ) {
            Observability.incrementCounter('plugin_worker_limit_rejections');
            throw new Error(
                `Plugin worker limit reached (cap=${tuning.plugin.maxWorkers})`
            );
        }

        Workers.startingWorkers.add(pluginName);
        // Register plugin worker w/ events
        let worker: Worker;
        try {
            worker = new Worker(path.join(__dirname, 'worker.js'), {
                resourceLimits: pluginWorkerResourceLimits(tuning.plugin),
                workerData: {
                    ...pluginData,
                    pluginsFolder: path.resolve(PLUGINS_FOLDER)
                }
            });
        } catch (err) {
            Workers.startingWorkers.delete(pluginName);
            throw err;
        }

        let commandId = 0;
        const waiting: Map<number, PendingCommand> = new Map();
        const nextCommandId = () => {
            const maxIdsToTry = waiting.size + 2;
            for (let attempts = 0; attempts < maxIdsToTry; attempts++) {
                const currentCommandId = commandId;
                commandId =
                    commandId >= Number.MAX_SAFE_INTEGER ? 0 : commandId + 1;
                if (!waiting.has(currentCommandId)) {
                    return currentCommandId;
                }
            }

            throw new Error('No free plugin command IDs available');
        };
        const rejectAllWaiting = (reason: Error): void => {
            for (const [, entry] of waiting) {
                clearTimeout(entry.timer);
                entry.reject(reason);
            }
            waiting.clear();
        };
        worker.on('message', (args) => {
            // Async body wrapped in .catch — Node ignores returned
            // Promise from event emitter callbacks otherwise.
            void (async () => {
                const [method, ...params] = args;
                switch (method) {
                    case 'load':
                        Workers.startingWorkers.delete(pluginName);
                        Workers.pluginWorkers.set(pluginName, worker);
                        PluginNotifier.invalidateMetadataHandlersCache();
                        break;
                    case 'unload':
                        Workers.startingWorkers.delete(pluginName);
                        Workers.pluginWorkers.delete(pluginName);
                        Workers.unregisterGeneratedComponents(pluginName);
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
                                        if (
                                            waiting.size >=
                                            tuning.plugin.commandQueueMax
                                        ) {
                                            Observability.incrementCounter(
                                                'plugin_command_queue_full'
                                            );
                                            reject(
                                                new Error(
                                                    `Plugin command queue full for ${name}.${method} (cap=${tuning.plugin.commandQueueMax})`
                                                )
                                            );
                                            return;
                                        }
                                        const currentCommandId =
                                            nextCommandId();
                                        sender.additional = undefined; // not serializable
                                        const safeSender = {
                                            group: sender.group,
                                            permissions: Array.from(
                                                sender.permissions || []
                                            ) // convert Set to array
                                        };
                                        const timeoutMs =
                                            tuning.plugin.commandTimeoutMs;
                                        const timer = setTimeout(() => {
                                            if (
                                                !waiting.delete(
                                                    currentCommandId
                                                )
                                            )
                                                return;
                                            Observability.incrementCounter(
                                                'plugin_command_timeouts'
                                            );
                                            reject(
                                                new Error(
                                                    `Plugin command ${name}.${method} timed out after ${timeoutMs}ms`
                                                )
                                            );
                                        }, timeoutMs);
                                        timer.unref?.();
                                        waiting.set(currentCommandId, {
                                            resolve,
                                            reject,
                                            timer
                                        });
                                        worker.postMessage([
                                            'command_called',
                                            currentCommandId,
                                            name,
                                            method,
                                            params,
                                            safeSender
                                        ]);
                                    })
                            );
                        }

                        const component = new PluginGeneratedComponent(
                            name,
                            methodsMap,
                            pluginName
                        );
                        Commander.registerComponent(component);
                        const registered =
                            Workers.generatedComponentsByPlugin.get(
                                pluginName
                            ) ?? new Set<string>();
                        registered.add(name.toLowerCase());
                        Workers.generatedComponentsByPlugin.set(
                            pluginName,
                            registered
                        );
                        break;
                    }

                    case 'command_response': {
                        const [id, response_type, data] = params;
                        const entry = waiting.get(id);
                        if (!entry) break;
                        waiting.delete(id);
                        clearTimeout(entry.timer);
                        if (response_type === 'resolve') {
                            entry.resolve(data);
                        } else {
                            entry.reject(data);
                        }
                        break;
                    }

                    case 'call_commander': {
                        const [call_id, method, pass_params] = params;
                        try {
                            if (!Workers.isRpcAllowed(pluginData, method)) {
                                throw new Error(
                                    `Plugin ${pluginName} is not allowed to call ${method}`
                                );
                            }
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
                        PluginNotifier.addMetadataFromPlugin(
                            metadata_id,
                            metadata
                        );
                        break;
                    }
                }
            })().catch((err) => {
                logger.error(
                    'plugin worker message handler threw: %s',
                    err instanceof Error ? err.message : String(err)
                );
            });
        });

        worker.on('error', (err) => {
            Workers.startingWorkers.delete(pluginName);
            Observability.incrementCounter('plugin_worker_errors');
            rejectAllWaiting(
                new Error(`Plugin worker error: ${err?.message || err}`)
            );
        });

        worker.on(
            'exit',
            guardListener('plugin-worker-exit', (code: number) => {
                Workers.startingWorkers.delete(pluginName);
                if (code !== 0)
                    Observability.incrementCounter('plugin_worker_crashes');
                rejectAllWaiting(
                    new Error(`Plugin worker exited with code ${code}`)
                );
                Workers.pluginWorkers.delete(pluginName);
                Workers.unregisterGeneratedComponents(pluginName);
            })
        );

        // Send load signal AFTER message handler is registered
        // to avoid race condition where worker responds before we're listening
        worker.postMessage(['load']);
    }

    public static getPluginWorkers() {
        return Workers.pluginWorkers;
    }

    public static unloadPlugin(pluginName: string): void {
        Workers.unregisterGeneratedComponents(pluginName);
        Workers.startingWorkers.delete(pluginName);
        Workers.pluginWorkers.delete(pluginName);
    }

    /** Terminate all workers, bounded by timeoutMs (FM_PLUGIN_SHUTDOWN_TIMEOUT_MS). */
    public static async terminateAll(
        timeoutMs: number = tuning.plugin.shutdownTimeoutMs
    ): Promise<void> {
        const workers = Array.from(Workers.pluginWorkers.values());
        if (workers.length === 0) return;
        logger.info(
            'Terminating %d plugin worker(s) with %dms grace',
            workers.length,
            timeoutMs
        );
        const perWorker = workers.map(async (worker) => {
            try {
                await Promise.race([
                    worker.terminate(),
                    new Promise<void>((resolve) =>
                        setTimeout(resolve, timeoutMs)
                    )
                ]);
            } catch (err) {
                logger.warn('Error terminating plugin worker:', err);
            }
        });
        await Promise.all(perWorker);
        Workers.pluginWorkers.clear();
        Workers.startingWorkers.clear();
    }
}

Observability.registerModule('pluginWorkers', {
    stats: () => ({
        activeWorkers: Workers.getPluginWorkers().size
    }),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'integrations',
        upstreams: ['events', 'plugins'],
        label: 'Plugin Workers',
        description: 'Plugin worker thread pool',
        route: '/monitoring/services'
    }
});
