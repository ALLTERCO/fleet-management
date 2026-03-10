import {type Ref, ref} from 'vue';
import {getPreloadedData, getRegistry, sendRPC} from '@/tools/websocket';
import * as ws from '../tools/websocket';

function storeData(prefix: string, key: string, data: object) {
    localStorage.setItem(prefix + key, JSON.stringify(data));
}

function loadData<T>(prefix: string, key: string): T | null {
    try {
        const raw = localStorage.getItem(prefix + key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch (error) {
        return null;
    }
}

export default function useRegistry<T extends {}>(
    registry: string,
    key: string
) {
    const prefix = `${registry}-registry-cache:`;
    // Priority: preloaded (fresh from server on connect) → localStorage cache → null
    const preloaded = getPreloadedData<T>(registry, key);
    const initial = preloaded ?? loadData<T>(prefix, key);
    const data = ref<T | null>(initial) as Ref<T | null>;
    const loading = ref(initial == null);
    const error = ref(false);

    const UIRegistry = ws.getRegistry(registry);

    async function execute() {
        loading.value = data.value == null;
        error.value = false;
        try {
            const item = await UIRegistry.getItem<T>(key);
            data.value = item;
            storeData(prefix, key, item);
        } catch (err) {
            error.value = true;
        } finally {
            loading.value = false;
        }
    }

    function refresh() {
        // Keep existing data visible while fetching — avoids spinner flash
        return execute();
    }

    async function upload() {
        await getRegistry('ui').setItem('dashboards', {
            id: key,
            items: data.value
        });
        await UIRegistry.setItem(key, data.value);
        await refresh();
    }

    // If data was preloaded (fresh from server), skip the initial RPC.
    // Otherwise fetch: localStorage data is shown immediately while RPC refreshes in background.
    if (!preloaded) {
        execute();
    }

    return {
        data,
        loading,
        error,
        refresh,
        upload
    };
}
