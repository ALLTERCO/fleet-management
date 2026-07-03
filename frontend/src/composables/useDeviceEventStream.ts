import {onUnmounted, type Ref, watch} from 'vue';
import {useDeviceEventsStore} from '@/stores/deviceEvents';
import type {DeviceChange} from '@/tools/deviceEventFormat';
import {
    addTemporarySubscription,
    type NamespacedEvent,
    onDeviceChange,
    type TemporarySubscription
} from '@/tools/websocket';

// Live wiring for the troubleshooting console. Subscribes DeviceEvent.Change
// scoped to the watched devices (server-side filter, so the browser only
// receives what it is watching) and feeds the store. Re-subscribes when the
// watched set changes; tears everything down on unmount.
export function useDeviceEventStream(shellyIds: Ref<string[]>): void {
    const store = useDeviceEventsStore();
    let sub: TemporarySubscription | null = null;

    const off = onDeviceChange((event: NamespacedEvent) => {
        const shellyId = event.params.shellyId;
        const changes = event.params.changes;
        if (typeof shellyId !== 'string' || !Array.isArray(changes)) return;
        store.addChanges(shellyId, changes as DeviceChange[]);
    });

    async function resubscribe(ids: string[]): Promise<void> {
        await sub?.unsubscribe();
        sub = null;
        if (ids.length === 0) return;
        sub = await addTemporarySubscription(ids, ['DeviceEvent.Change']);
    }

    // Surface a failed (re)subscribe rather than swallowing it — a silent
    // failure would leave the console looking live while delivering nothing.
    watch(
        shellyIds,
        (ids) => {
            resubscribe([...ids]).catch((err) => {
                console.error('device-event subscription failed', ids, err);
            });
        },
        {immediate: true}
    );

    onUnmounted(() => {
        off();
        void sub?.unsubscribe();
    });
}
