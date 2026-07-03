// Shared run-a-mutation helper for the ingress operator tabs: one home for the
// saving flag, toast on success, and error handling, so each page stays focused
// on its own data and actions.

import {ref} from 'vue';
import {useToastStore} from '@/stores/toast';

export function useIngressMutation() {
    const saving = ref(false);
    const toast = useToastStore();

    async function run(
        mutate: () => Promise<unknown>,
        successMessage: string,
        onDone?: () => Promise<void> | void
    ): Promise<void> {
        saving.value = true;
        try {
            await mutate();
            toast.success(successMessage);
            await onDone?.();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Action failed');
        } finally {
            saving.value = false;
        }
    }

    return {saving, run};
}
