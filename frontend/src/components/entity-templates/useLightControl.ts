import {computed, ref} from 'vue';
import {sendRPC} from '@/tools/websocket';

// `rpcType` is the namespace (Light, RGB, RGBW, CCT, RGBCCT) — matches the
// canonical FM Component exposing SetConfig.
export function useLightControl(
    props: {
        status: Record<string, any> | undefined;
        settings: Record<string, any> | undefined;
        canExecute: boolean;
        shellyID?: string;
        entityId?: string;
    },
    rpcType: string
) {
    const configError = ref<string | null>(null);
    const isOn = computed(() => !!props.status?.output);

    async function setConfig(config: Record<string, any>) {
        if (!props.shellyID) return;
        configError.value = null;
        try {
            await sendRPC('FLEET_MANAGER', `${rpcType}.SetConfig`, {
                shellyID: props.shellyID,
                id: props.status?.id ?? 0,
                config
            });
        } catch (e: any) {
            configError.value = e.message || 'Failed to update config';
        }
    }

    return {
        isOn,
        configError,
        setConfig
    };
}
