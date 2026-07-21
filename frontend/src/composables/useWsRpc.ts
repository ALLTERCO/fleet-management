import {onScopeDispose, type Ref, ref} from 'vue';
import {createStaleGuard} from '@/stores/staleGuard';
import {debugWarn} from '@/tools/debug';
import * as ws from '@/tools/websocket';
import {consumePreloadedRpc} from '@/tools/websocket';
import {isRecoverableReconnectError} from '@/tools/wsReconnectErrors';

const RPC_CACHE_PREFIX = 'rpc-cache:';

// Order-independent JSON so the cache key is stable regardless of key order.
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
            (k) =>
                `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`
        );
    return `{${entries.join(',')}}`;
}

function cacheKey(method: string, params: object): string {
    return `${RPC_CACHE_PREFIX}${method}:${stableStringify(params)}`;
}

export function clearRpcCaches() {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(RPC_CACHE_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
}

function loadCached<T>(method: string, params: object): T | null {
    const key = cacheKey(method, params);
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch (error) {
        localStorage.removeItem(key);
        debugWarn('RPC cache entry discarded', {method, error});
        return null;
    }
}

function storeCache(method: string, params: object, data: object) {
    // A write failure (quota full, private mode, storage disabled) must not
    // demote a successful RPC to an error — the cache is a bonus, not the reply.
    try {
        localStorage.setItem(cacheKey(method, params), JSON.stringify(data));
    } catch (error) {
        debugWarn('RPC cache entry not stored', {method, error});
    }
}

interface UseWsRpcOptions {
    /** When true, don't fire the initial RPC — wait for manual refresh() call. */
    lazy?: boolean;
}

export default function useWsRpc<T>(
    method: string,
    params: Record<string, any> = {},
    options: UseWsRpcOptions = {}
) {
    // Priority: preloaded (fresh from server on connect) → localStorage cache → null
    // consume (delete) preloaded data so re-mounts always fire a fresh RPC
    const preloaded = consumePreloadedRpc<T>(method);
    const initial = preloaded ?? loadCached<T>(method, params);
    const data = ref<T | null>(initial) as Ref<T | null>;
    const loading = ref(initial == null && !options.lazy);
    const error = ref(false);

    let retryPending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    // Latest-wins: a newer execute or an invalidate() discards older responses.
    const guard = createStaleGuard();

    function execute() {
        if (disposed) return;
        loading.value = data.value == null;
        error.value = false;
        retryPending = false;
        doExecute();
    }

    async function doExecute() {
        const token = guard.bump();
        try {
            const res = await ws.sendRPC('FLEET_MANAGER', method, params);
            if (disposed || guard.isStale(token)) return;
            data.value = res;
            if (res != null && typeof res === 'object')
                storeCache(method, params, res);
        } catch (err) {
            if (disposed || guard.isStale(token)) return;
            if (isRetryableError(err)) {
                scheduleRetry();
                return;
            }
            error.value = true;
        } finally {
            if (!disposed && !retryPending) loading.value = false;
        }
    }

    // For optimistic local mutations: discard any in-flight response.
    function invalidate(): void {
        guard.bump();
    }

    function isRetryableError(err: unknown): boolean {
        return isRecoverableReconnectError(err);
    }

    function scheduleRetry() {
        retryPending = true;
        retryTimer = setTimeout(() => execute(), 3000);
    }

    // Clean up retry timers when the component/scope is disposed.
    // Prevents zombie retries from unmounted tabs flooding the WebSocket.
    onScopeDispose(() => {
        disposed = true;
        if (retryTimer != null) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
        }
    });

    // If preloaded, show instantly but still fire a background refresh.
    // If lazy, don't fire until consumer calls refresh().
    // If localStorage cache, show it immediately and refresh in background.
    // If nothing, fire RPC (spinner will show).
    if (!options.lazy) {
        execute();
    }

    function refresh() {
        return execute();
    }

    return {
        data,
        loading,
        error,
        refresh,
        invalidate
    };
}
