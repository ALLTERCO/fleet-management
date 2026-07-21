/** Shared "reset counters" action used by Switch, Cover, Light, Input.
 *  Wraps the entity-store invokeAction pattern and writes failure messages
 *  into the caller's configError ref. */

import type {Ref} from 'vue';
import {deviceActionErrorMessage} from '@/helpers/deviceActionError';
import {useEntityStore} from '@/stores/entities';

interface UseResetCountersOptions {
    entityId: () => string | undefined;
    configError: Ref<string | null>;
}

export function useResetCounters(opts: UseResetCountersOptions) {
    const entityStore = useEntityStore();

    async function resetCounters() {
        const eid = opts.entityId();
        if (!eid) return;
        opts.configError.value = null;
        try {
            await entityStore.invokeAction(eid, 'resetCounters');
        } catch (e: unknown) {
            opts.configError.value = deviceActionErrorMessage(
                e,
                'Reset counters'
            );
        }
    }

    return {resetCounters};
}
