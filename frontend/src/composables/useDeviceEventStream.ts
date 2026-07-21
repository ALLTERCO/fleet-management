import {onUnmounted, type Ref, ref, watch} from 'vue';
import {formatRpcError} from '@/helpers/domainErrors';
import {useDeviceEventsStore} from '@/stores/deviceEvents';
import type {DeviceChange} from '@/tools/deviceEventFormat';
import {
    addTemporarySubscription,
    type NamespacedEvent,
    onDeviceChange,
    type TemporarySubscription
} from '@/tools/websocket';
import {DEVICE_CHANGE_EVENT} from '@/tools/wsEvents';

// Live wiring for the troubleshooting console. Subscribes DeviceEvent.Change
// scoped to the watched devices (server-side filter, so the browser only
// receives what it is watching) and feeds the store. Re-subscribes when the
// watched set changes; tears everything down on unmount.
export function useDeviceEventStream(shellyIds: Ref<string[]>): {
    // Non-null while the live subscription is broken — the consumer renders it.
    subscriptionError: Ref<string | null>;
} {
    const store = useDeviceEventsStore();
    const subscriptionError = ref<string | null>(null);
    let sub: TemporarySubscription | null = null;

    const off = onDeviceChange((event: NamespacedEvent) => {
        const shellyId = event.params.shellyId;
        const changes = event.params.changes;
        if (typeof shellyId !== 'string' || !Array.isArray(changes)) return;
        store.addChanges(shellyId, changes as DeviceChange[]);
    });

    // Monotonic token so overlapping resubscribes (fast shellyIds changes)
    // can't orphan a server-side subscription: only the latest call keeps its
    // handle; any superseded call unsubscribes the handle it created.
    let resubToken = 0;
    async function resubscribe(ids: string[]): Promise<void> {
        const token = ++resubToken;
        const prev = sub;
        sub = null;
        await prev?.unsubscribe();
        if (ids.length === 0) {
            subscriptionError.value = null;
            return;
        }
        const next = await addTemporarySubscription(ids, [DEVICE_CHANGE_EVENT]);
        if (token !== resubToken) {
            void next.unsubscribe();
            return;
        }
        sub = next;
        subscriptionError.value = null;
    }

    // Surface a failed (re)subscribe rather than swallowing it — a silent
    // failure would leave the console looking live while delivering nothing.
    watch(
        shellyIds,
        (ids) => {
            resubscribe([...ids]).catch((err) => {
                subscriptionError.value = `Live events paused — ${formatRpcError(err, 'subscription failed')}`;
            });
        },
        {immediate: true}
    );

    onUnmounted(() => {
        off();
        void sub?.unsubscribe();
    });

    return {subscriptionError};
}
