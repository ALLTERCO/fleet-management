import type {event_data_t, json_rpc_event} from '../../types';
import PluginLoader from './PluginLoader';
import Workers from './Workers';

export default class PluginNotifier {
    private static metadata_id = 0;
    private static metadataWaiting = new Map<
        number,
        {resolve: (val: any) => any; reject: () => any}
    >();

    public static async sendForMetadata(
        event: json_rpc_event,
        eventData: event_data_t
    ) {
        for (const [name, worker] of Workers.getPluginWorkers().entries()) {
            const config = PluginLoader.getPluginData().get(name);
            if (config === undefined) continue;
            const metadata = config.info.config?.metadata;
            if (
                metadata !== undefined &&
                typeof metadata === 'boolean' &&
                metadata
            ) {
                // we found a preprocessor
                const currentID = PluginNotifier.metadata_id;
                PluginNotifier.metadata_id = PluginNotifier.metadata_id + 1;
                // send JSON version of device
                const sendData = {
                    ...eventData,
                    device: eventData.device?.toJSON()
                };
                worker.postMessage([
                    'add_metadata',
                    event,
                    sendData,
                    currentID
                ]);
                const response: any = await new Promise((resolve, reject) => {
                    PluginNotifier.metadataWaiting.set(currentID, {
                        resolve,
                        reject
                    });
                });
                if (response) {
                    event.params.metadata = {
                        ...event.params.metadata,
                        ...response
                    };
                }
            }
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
        for (const pluginWorker of Workers.getPluginWorkers().values()) {
            pluginWorker.postMessage(['on', event, eventData]);
        }
    }

    public static addMetadataFromPlugin(metadata_id: number, metadata: any) {
        const metadataPromise = PluginNotifier.metadataWaiting.get(metadata_id);
        if (metadataPromise) {
            metadataPromise.resolve(metadata);
        }
    }
}
