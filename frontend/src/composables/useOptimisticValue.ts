// Optimistic UI value. `display` flips to the user's target immediately;
// `commit` runs the action and reverts only on failure.

import {computed, type Ref, ref, watch} from 'vue';

export interface OptimisticValueApi<T> {
    readonly display: Readonly<Ref<T>>;
    readonly commit: (
        value: T,
        action: () => Promise<unknown>
    ) => Promise<void>;
}

export function useOptimisticValue<T>(
    source: Readonly<Ref<T>>
): OptimisticValueApi<T> {
    const pending = ref<T | null>(null) as Ref<T | null>;
    const display = computed<T>(() =>
        pending.value === null ? source.value : pending.value
    );

    watch(source, (next) => {
        if (pending.value === next) pending.value = null;
    });

    function revertIfStillPending(value: T): void {
        if (pending.value === value) pending.value = null;
    }

    async function commit(
        value: T,
        action: () => Promise<unknown>
    ): Promise<void> {
        pending.value = value;
        try {
            await action();
        } catch (err) {
            revertIfStillPending(value);
            throw err;
        }
    }

    return {display, commit};
}
