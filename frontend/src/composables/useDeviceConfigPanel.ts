import {computed, onMounted, reactive, ref, toRefs, watch} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import {useSettingsDirtySource} from './useSettingsDirtyTracker';

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
    /** Side effect to run after a successful save. */
    onSaved?: (local: TLocal, response: unknown) => void;
    /** Extra RPC params merged at top level (e.g., `id` for indexed components). */
    extraParams?: () => ExtraParams;
    /**
     * Nav section this panel's dirty state belongs to. Defaults to the
     * settingsKey — set it when several panels share one settings namespace
     * (e.g. RPC over UDP edits `sys` but is its own page).
     */
    sectionId?: string;
}

export function useDeviceConfigPanel<TConfig, TLocal extends object>(
    opts: DeviceConfigPanelOptions<TConfig, TLocal>
) {
    const deviceStore = useDevicesStore();
    const toast = useToastStore();

    const config = ref<TConfig | null>(null);
    const local = reactive(opts.initialLocal) as TLocal;
    const saving = ref(false);
    const restartRequired = ref(false);
    const rebooting = ref(false);
    const externalConfigChanged = ref(false);
    let loadedConfigJson = '';
    // Dirty is a real diff against the loaded values — reverting an edit by
    // hand clears the unsaved state, no Discard needed.
    const localBaseline = ref('');
    function serializeLocal(): string {
        return JSON.stringify(opts.mapToUpdate(local));
    }
    const dirty = computed(
        () => config.value !== null && serializeLocal() !== localBaseline.value
    );
    const sectionKey = opts.settingsKey.split(':', 1)[0];
    useSettingsDirtySource(
        opts.sectionId ?? `config:${sectionKey}`,
        `device-config:${opts.sectionId ?? opts.settingsKey}`,
        dirty
    );

    function readConfig(): TConfig | undefined {
        const id = opts.shellyID();
        return deviceStore.devices[id]?.settings?.[opts.settingsKey];
    }

    function applyConfig(c: TConfig): void {
        config.value = c;
        loadedConfigJson = JSON.stringify(c);
        Object.assign(local, opts.mapToLocal(c, local));
        localBaseline.value = serializeLocal();
        externalConfigChanged.value = false;
    }

    function loadConfig(): void {
        const c = readConfig();
        if (c === undefined || c === null) {
            config.value = null;
            return;
        }
        applyConfig(c as TConfig);
    }

    const refetching = ref(false);

    // Fetch path: the store had nothing usable, so ask the device directly
    // through the matching GetConfig wrapper. Silent mode is the automatic
    // attempt on open — failures leave the Retry block, without toast spam.
    async function fetchFromDevice(silent: boolean): Promise<void> {
        const id = opts.shellyID();
        if (!id) {
            if (!silent) toast.error('Device not available');
            return;
        }
        refetching.value = true;
        try {
            const method = opts.method.replace(/\.SetConfig$/, '.GetConfig');
            const response = await sendRPC<TConfig>('FLEET_MANAGER', method, {
                shellyID: id,
                ...(opts.extraParams?.() ?? {})
            });
            if (response === undefined || response === null) {
                if (!silent) {
                    toast.error('The device returned no configuration');
                }
                return;
            }
            applyConfig(response);
        } catch (err: unknown) {
            if (!silent) toast.error(rpcErrorMessage(err));
        } finally {
            refetching.value = false;
        }
    }

    // Manual Retry — parameterless so templates can bind it to @click.
    function refetch(): Promise<void> {
        return fetchFromDevice(false);
    }

    // Load on open without a Retry click: when the store has no config yet
    // and the device is reachable, fetch it right away.
    function autoRefetch(): void {
        if (config.value !== null) return;
        const id = opts.shellyID();
        if (!deviceStore.devices[id]?.online) return;
        void fetchFromDevice(true);
    }

    // Kept for call-site compatibility — dirty is now a live diff, so the
    // v-model mutation alone is enough.
    function markDirty(): void {}

    async function save(): Promise<void> {
        const id = opts.shellyID();
        if (!id) {
            toast.error('Device not available');
            return;
        }
        saving.value = true;
        try {
            const response = await sendRPC('FLEET_MANAGER', opts.method, {
                shellyID: id,
                ...(opts.extraParams?.() ?? {}),
                config: opts.mapToUpdate(local)
            });
            toast.success(opts.successToast);
            externalConfigChanged.value = false;
            restartRequired.value =
                (response as {restart_required?: unknown} | null | undefined)
                    ?.restart_required === true;
            opts.onSaved?.(local, response);
            // The saved values are the new baseline (after onSaved cleanup).
            localBaseline.value = serializeLocal();
        } catch (err: unknown) {
            toast.error(rpcErrorMessage(err));
        } finally {
            saving.value = false;
        }
    }

    async function rebootDevice(): Promise<void> {
        const id = opts.shellyID();
        if (!id) {
            toast.error('Device not available');
            return;
        }
        rebooting.value = true;
        try {
            await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {shellyID: id});
            toast.info('Device rebooting');
            restartRequired.value = false;
        } catch (err: unknown) {
            toast.error(rpcErrorMessage(err));
        } finally {
            rebooting.value = false;
        }
    }

    onMounted(() => {
        loadConfig();
        autoRefetch();
    });
    watch(opts.shellyID, () => {
        restartRequired.value = false;
        loadConfig();
        autoRefetch();
    });

    // Keep an open form in sync with the store: a clean form silently reloads
    // (covers device-side normalization after save and edits from elsewhere);
    // a dirty form keeps the draft but flags the conflict for the user.
    watch(
        () => readConfig(),
        (next) => {
            if (next === undefined || next === null) return;
            if (!dirty.value) {
                loadConfig();
                return;
            }
            if (JSON.stringify(next) !== loadedConfigJson) {
                externalConfigChanged.value = true;
            }
        },
        {deep: true}
    );

    return {
        config,
        local,
        localRefs: toRefs(local),
        dirty,
        saving,
        restartRequired,
        rebooting,
        externalConfigChanged,
        refetching,
        markDirty,
        save,
        rebootDevice,
        refetch,
        reload: loadConfig
    };
}
