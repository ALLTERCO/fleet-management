import {useEntityStore} from '@/stores/entities';
import {useToastStore} from '@/stores/toast';

// Card surface is locked to Entity.InvokeAction — raw device RPC is reserved
// for the Automations page. Cards have only invokeAction here so a regression
// to direct-device calls fails at compile time.
export function useCardRpc() {
    const entityStore = useEntityStore();
    const toastStore = useToastStore();

    function invokeAction(
        entityId: string,
        action: string,
        params?: Record<string, unknown>,
        context?: string
    ): Promise<void> {
        return entityStore.invokeAction(entityId, action, params).catch(() => {
            toastStore.error(context ? `${context} failed` : 'Command failed');
        });
    }

    return {invokeAction};
}
