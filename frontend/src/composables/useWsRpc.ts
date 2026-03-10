import {onScopeDispose, type Ref, ref} from 'vue';
import * as ws from '@/tools/websocket';
import {consumePreloadedRpc} from '@/tools/websocket';

const RPC_CACHE_PREFIX = 'rpc-cache:';

function loadCached<T>(method: string): T | null {
    try {
        const raw = localStorage.getItem(RPC_CACHE_PREFIX + method);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function storeCache(method: string, data: object) {
    localStorage.setItem(RPC_CACHE_PREFIX + method, JSON.stringify(data));
}

interface UseFleetManagerRpcOptions {
    /** When true, don't fire the initial RPC — wait for manual refresh() call. */
    lazy?: boolean;
}

export default function useFleetManagerRpc<T>(
    method: string,
    params: Record<string, any> = {},
    options: UseFleetManagerRpcOptions = {}
) {
    // Priority: preloaded (fresh from server on connect) → localStorage cache → null
    // consume (delete) preloaded data so re-mounts always fire a fresh RPC
    const preloaded = consumePreloadedRpc<T>(method);
    const initial = preloaded ?? loadCached<T>(method);
    const data = ref<T | null>(initial) as Ref<T | null>;
    const loading = ref(initial == null && !options.lazy);
    const error = ref(false);

    let retryPending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function execute() {
        if (disposed) return;
        // Only show spinner if we have no data at all (first-ever visit)
        loading.value = data.value == null;
        error.value = false;
        retryPending = false;
        ws.sendRPC('FLEET_MANAGER', method, params)
            .then(
                (res) => {
                    if (disposed) return;
                    data.value = res;
                    if (res != null && typeof res === 'object') {
                        storeCache(method, res);
                    }
                },
                (err) => {
                    if (disposed) return;
                    // If WS closed or RPC timed out, retry after reconnect delay
                    // instead of showing a permanent error state.
                    // Keep loading=true so templates don't show a blank gap.
                    if (
                        err instanceof Error &&
                        (err.message === 'WebSocket closed' ||
                            err.message.startsWith('RPC timeout'))
                    ) {
                        retryPending = true;
                        retryTimer = setTimeout(() => execute(), 3000);
                        return;
                    }
                    error.value = true;
                }
            )
            .finally(() => {
                if (disposed) return;
                // Don't clear loading while a retry is scheduled —
                // otherwise templates see loading=false + data=null → blank screen
                if (!retryPending) {
                    loading.value = false;
                }
            });
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
        refresh
    };
}
