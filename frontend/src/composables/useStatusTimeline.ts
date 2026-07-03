import type {MaybeRefOrGetter} from 'vue';
import {computed, onScopeDispose, ref, toValue, watch} from 'vue';
import * as ws from '@/tools/websocket';

export type TimelineRange = '6h' | '24h';

export interface TimelineEvent {
    ts: string;
    value: number | null;
    prevValue: number | null;
}

function rangeToParams(range: TimelineRange): {from: string; to: string} {
    const now = new Date();
    const msBack = range === '6h' ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return {
        from: new Date(now.getTime() - msBack).toISOString(),
        to: now.toISOString()
    };
}

export function useStatusTimeline(
    shellyId: MaybeRefOrGetter<string | undefined>,
    field: MaybeRefOrGetter<string | undefined>,
    range: MaybeRefOrGetter<TimelineRange>
) {
    const data = ref<TimelineEvent[]>([]);
    const loading = ref(false);
    const error = ref(false);
    let disposed = false;
    let abortId = 0;

    async function fetch() {
        const id = toValue(shellyId);
        const f = toValue(field);
        if (!id || !f) {
            data.value = [];
            return;
        }
        const thisCall = ++abortId;
        loading.value = true;
        error.value = false;
        try {
            const {from, to} = rangeToParams(toValue(range));
            const result = await ws.sendRPC<{data: TimelineEvent[]}>(
                'FLEET_MANAGER',
                'device.getstatustimeline',
                {shellyID: id, field: f, from, to}
            );
            if (disposed || thisCall !== abortId) return;
            data.value = result?.data ?? [];
        } catch {
            if (disposed || thisCall !== abortId) return;
            error.value = true;
            data.value = [];
        } finally {
            if (!disposed && thisCall === abortId) loading.value = false;
        }
    }

    const trigger = computed(() => ({
        id: toValue(shellyId),
        f: toValue(field),
        r: toValue(range)
    }));

    watch(trigger, () => fetch(), {immediate: true});

    onScopeDispose(() => {
        disposed = true;
    });

    return {data, loading, error, refresh: fetch};
}
