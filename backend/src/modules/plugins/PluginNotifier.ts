import type {event_data_t, json_rpc_event} from '../../types';
import PluginLoader from './PluginLoader';
import {registerPluginEventNotifier} from './pluginEventPort';
import Workers from './Workers';

export default class PluginNotifier {
    private static metadata_id = 0;
    private static metadataWaiting = new Map<
        number,
        {resolve: (val: any) => any; reject: () => any}
    >();
    private static readonly METADATA_TIMEOUT_MS = 10_000;

    private static nextMetadataId() {
        const maxIdsToTry = PluginNotifier.metadataWaiting.size + 2;
        for (let attempts = 0; attempts < maxIdsToTry; attempts++) {
            const currentID = PluginNotifier.metadata_id;
            PluginNotifier.metadata_id =
                PluginNotifier.metadata_id >= Number.MAX_SAFE_INTEGER
                    ? 0
                    : PluginNotifier.metadata_id + 1;
            if (!PluginNotifier.metadataWaiting.has(currentID)) {
                return currentID;
            }
        }

        throw new Error('No free plugin metadata IDs available');
    }

    public static async sendForMetadata(
        event: json_rpc_event,
        eventData: event_data_t
    ) {
        const metadataPromises: Promise<any>[] = [];

        for (const [name, worker] of Workers.getPluginWorkers().entries()) {
            const config = PluginLoader.getPluginData().get(name);
            if (config === undefined) continue;
            const metadata = config.info.config?.metadata;
            if (
                metadata !== undefined &&
                typeof metadata === 'boolean' &&
                metadata
            ) {
                metadataPromises.push(
                    (async () => {
                        const currentID = PluginNotifier.nextMetadataId();
                        const sendData = {
                            ...eventData,
                            device: eventData.device?.toJSON()
                        };

                        return await new Promise((resolve) => {
                            const timer = setTimeout(() => {
                                PluginNotifier.metadataWaiting.delete(
                                    currentID
                                );
                                resolve(null);
                            }, PluginNotifier.METADATA_TIMEOUT_MS);

                            PluginNotifier.metadataWaiting.set(currentID, {
                                resolve: (val) => {
                                    clearTimeout(timer);
                                    resolve(val);
                                },
                                reject: () => {
                                    clearTimeout(timer);
                                    resolve(null);
                                }
                            });

                            worker.postMessage([
                                'add_metadata',
                                event,
                                sendData,
                                currentID
                            ]);
                        });
                    })()
                );
            }
        }

        const responses = await Promise.all(metadataPromises);
        for (const response of responses) {
            if (!response) continue;
            event.params.metadata = {
                ...event.params.metadata,
                ...response
            };
        }

        return event;
    }

    private static _hasMetadataHandlers: boolean | null = null;

    public static hasMetadataHandlers(): boolean {
        if (PluginNotifier._hasMetadataHandlers !== null) {
            return PluginNotifier._hasMetadataHandlers;
        }
        for (const [name] of Workers.getPluginWorkers().entries()) {
            const config = PluginLoader.getPluginData().get(name);
            if (config?.info.config?.metadata === true) {
                PluginNotifier._hasMetadataHandlers = true;
                return true;
            }
        }
        PluginNotifier._hasMetadataHandlers = false;
        return false;
    }

    public static invalidateMetadataHandlersCache() {
        PluginNotifier._hasMetadataHandlers = null;
    }

    public static notifyEvent(event: json_rpc_event, eventData?: event_data_t) {
        const safeData = eventData
            ? {...eventData, device: eventData.device?.toJSON()}
            : eventData;
        for (const pluginWorker of Workers.getPluginWorkers().values()) {
            pluginWorker.postMessage(['on', event, safeData]);
        }
    }

    public static addMetadataFromPlugin(metadata_id: number, metadata: any) {
        const metadataPromise = PluginNotifier.metadataWaiting.get(metadata_id);
        if (metadataPromise) {
            PluginNotifier.metadataWaiting.delete(metadata_id);
            metadataPromise.resolve(metadata);
        }
    }
}

registerPluginEventNotifier({
    hasMetadataHandlers: () => PluginNotifier.hasMetadataHandlers(),
    sendForMetadata: (event, eventData) =>
        PluginNotifier.sendForMetadata(event, eventData),
    notifyEvent: (event, eventData) =>
        PluginNotifier.notifyEvent(event, eventData)
});
