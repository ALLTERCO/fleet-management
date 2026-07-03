import type {event_data_t, json_rpc_event} from '../../types';

interface PluginEventNotifier {
    hasMetadataHandlers(): boolean;
    sendForMetadata(
        event: json_rpc_event,
        eventData: event_data_t
    ): Promise<json_rpc_event>;
    notifyEvent(event: json_rpc_event, eventData?: event_data_t): void;
}

let notifier: PluginEventNotifier | null = null;

export function registerPluginEventNotifier(next: PluginEventNotifier): void {
    notifier = next;
}

export function hasPluginMetadataHandlers(): boolean {
    return notifier?.hasMetadataHandlers() ?? false;
}

export async function sendPluginMetadata(
    event: json_rpc_event,
    eventData: event_data_t
): Promise<json_rpc_event> {
    return (await notifier?.sendForMetadata(event, eventData)) ?? event;
}

export function notifyPluginEvent(
    event: json_rpc_event,
    eventData?: event_data_t
): void {
    notifier?.notifyEvent(event, eventData);
}
