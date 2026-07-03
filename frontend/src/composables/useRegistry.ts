import {type Ref, ref} from 'vue';
import {getPreloadedData} from '@/tools/websocket';
import * as ws from '../tools/websocket';

const REGISTRY_CACHE_SUFFIX = '-registry-cache:';

export function clearRegistryCaches() {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.includes(REGISTRY_CACHE_SUFFIX)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
}

function storeData(prefix: string, entry: {key: string; data: object}) {
    localStorage.setItem(prefix + entry.key, JSON.stringify(entry.data));
}

function loadData<T>(prefix: string, key: string): T | null {
    try {
        const raw = localStorage.getItem(prefix + key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch (_error) {
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
            storeData(prefix, {key, data: item});
        } catch (_err) {
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
        await UIRegistry.setItem(key, data.value);
        await refresh();
    }

    // Always fetch fresh data from the server in the background.
    // Preloaded/cached data is shown immediately to avoid blank screens,
    // but it may be stale (e.g. widgets added since connect or last visit).
    execute();

    return {
        data,
        loading,
        error,
        refresh,
        upload
    };
}
