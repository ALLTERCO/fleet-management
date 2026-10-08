// The one place Vue reactivity meets the framework-neutral store contract.

import {
    type ComputedRef,
    getCurrentScope,
    onScopeDispose,
    type Ref,
    readonly,
    ref,
    watch
} from 'vue';
import type {ExternalStore} from '../core/external-store';

export type VueStoreBridge = {
    /** Exposes a Vue source as an ExternalStore. */
    toExternalStore<T>(source: Ref<T> | ComputedRef<T>): ExternalStore<T>;
    /** Stops every watcher this bridge created. Idempotent. */
    dispose(): void;
};

/**
 * An ExternalStore has no disposal hook, so the bridge owns the watchers.
 * Without it, a per-mount runtime context leaks a watcher on every remount.
 */
export function createVueStoreBridge(): VueStoreBridge {
    const stoppers: Array<() => void> = [];

    return {
        toExternalStore<T>(source: Ref<T> | ComputedRef<T>): ExternalStore<T> {
            const listeners = new Set<() => void>();
            stoppers.push(
                watch(
                    source,
                    () => {
                        for (const listener of [...listeners]) listener();
                    },
                    // Synchronous so a read right after a mutation is current.
                    {flush: 'sync', deep: false}
                )
            );
            return {
                getSnapshot: () => source.value,
                subscribe(listener) {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                }
            };
        },
        dispose() {
            while (stoppers.length > 0) stoppers.pop()?.();
        }
    };
}

/** Projects an ExternalStore onto a read-only Vue ref. */
export function useExternalStore<T>(store: ExternalStore<T>): Readonly<Ref<T>> {
    const value = ref(store.getSnapshot()) as Ref<T>;
    const release = store.subscribe(() => {
        value.value = store.getSnapshot();
    });
    // Outside a component scope (a plain script, a test) the caller releases.
    if (getCurrentScope()) onScopeDispose(release);
    return readonly(value) as Readonly<Ref<T>>;
}

/** The React binding's name for this hook. Both are exported so a template
 * moving between bindings keeps the name it already imports. */
export const useFleetStore = useExternalStore;
