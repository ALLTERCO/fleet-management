import {ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';

// Shared save-flash state machine for edit modals.
// idle → saving → ✓ flash → close. Callers supply the persist task and
// the on-success callback; flash duration comes from UI_CONFIG.
export interface UseOptimisticSaveOptions<T> {
    onSuccess: (result: T) => void;
    /** Override UI_CONFIG.optimisticFlashMs for this instance. */
    flashMs?: number;
}

export function useOptimisticSave<T>(options: UseOptimisticSaveOptions<T>) {
    const saving = ref(false);
    const justSaved = ref(false);

    async function runOptimisticSave(
        task: () => Promise<T | null | undefined>
    ): Promise<void> {
        saving.value = true;
        const result = await runAndClearSaving(task);
        if (!isTruthy(result)) return;
        await flashAndComplete(result);
    }

    async function runAndClearSaving(
        task: () => Promise<T | null | undefined>
    ): Promise<T | null | undefined> {
        try {
            return await task();
        } finally {
            saving.value = false;
        }
    }

    function isTruthy(r: T | null | undefined): r is T {
        return r !== null && r !== undefined && (r as unknown) !== false;
    }

    async function flashAndComplete(result: T): Promise<void> {
        justSaved.value = true;
        await sleep(options.flashMs ?? UI_CONFIG.optimisticFlashMs);
        justSaved.value = false;
        options.onSuccess(result);
    }

    function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    return {saving, justSaved, runOptimisticSave};
}
