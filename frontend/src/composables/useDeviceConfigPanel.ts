import {onMounted, reactive, ref, toRefs, watch} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

type ExtraParams = Record<string, unknown> & {
    shellyID?: never;
    config?: never;
};

export interface DeviceConfigPanelOptions<TConfig, TLocal extends object> {
    /** Reactive shellyID source — composable rewires on change. */
    shellyID: () => string;
    /** Key under `device.settings` that holds this panel's config. */
    settingsKey: string;
    /** Backend RPC method, e.g. 'Cloud.SetConfig'. */
    method: string;
    /** Initial local form state — reactive after wiring. */
    initialLocal: TLocal;
    /** Map device-side config → form fields whenever the source changes. */
    mapToLocal: (cfg: TConfig, current: TLocal) => Partial<TLocal>;
    /** Map form fields → wire payload sent inside `{config: ...}`. */
    mapToUpdate: (local: TLocal) => Partial<TConfig>;
    /** Toast message on successful save. */
    successToast: string;
    /** Side effect to run after a successful save (e.g., clear password field). */
    onSaved?: (local: TLocal) => void;
    /** Extra RPC params merged at top level (e.g., `id` for indexed components). */
    extraParams?: () => ExtraParams;
}

export function useDeviceConfigPanel<TConfig, TLocal extends object>(
    opts: DeviceConfigPanelOptions<TConfig, TLocal>
) {
    const deviceStore = useDevicesStore();
    const toast = useToastStore();

    const config = ref<TConfig | null>(null);
    const local = reactive(opts.initialLocal) as TLocal;
    const dirty = ref(false);
    const saving = ref(false);

    function readConfig(): TConfig | undefined {
        const id = opts.shellyID();
        return deviceStore.devices[id]?.settings?.[opts.settingsKey];
    }

    function loadConfig(): void {
        const c = readConfig();
        if (c === undefined || c === null) {
            config.value = null;
            return;
        }
        config.value = c as TConfig;
        Object.assign(local, opts.mapToLocal(c as TConfig, local));
        dirty.value = false;
    }

    function markDirty(): void {
        dirty.value = true;
    }

    async function save(): Promise<void> {
        const id = opts.shellyID();
        if (!id) {
            toast.error('Device not available');
            return;
        }
        saving.value = true;
        try {
            await sendRPC('FLEET_MANAGER', opts.method, {
                shellyID: id,
                ...(opts.extraParams?.() ?? {}),
                config: opts.mapToUpdate(local)
            });
            toast.success(opts.successToast);
            dirty.value = false;
            opts.onSaved?.(local);
        } catch (err: unknown) {
            toast.error(rpcErrorMessage(err));
        } finally {
            saving.value = false;
        }
    }

    onMounted(loadConfig);
    watch(opts.shellyID, () => {
        dirty.value = false;
        loadConfig();
    });

    return {
        config,
        local,
        localRefs: toRefs(local),
        dirty,
        saving,
        markDirty,
        save,
        reload: loadConfig
    };
}
