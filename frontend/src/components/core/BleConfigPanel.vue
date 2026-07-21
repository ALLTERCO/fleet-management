<template>
    <div class="ble-panel">
        <form v-if="config" @submit.prevent autocomplete="off">
            <section
                id="ble-panel-radio"
                class="ble-panel__view"
                aria-labelledby="ble-radio-title"
            >
                <header class="ble-panel__view-header">
                    <div>
                        <h4 id="ble-radio-title">Bluetooth radio</h4>
                        <p>Control device discovery and local BLE access.</p>
                    </div>
                </header>

                <div class="ble-panel__setting-list">
                    <div class="ble-panel__setting">
                        <div class="ble-panel__setting-copy">
                            <strong>Bluetooth</strong>
                            <span>Allow this device to use its BLE radio.</span>
                        </div>
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable Bluetooth"
                            @update:model-value="markDirty"
                        />
                    </div>

                    <div class="ble-panel__setting">
                        <div class="ble-panel__setting-copy">
                            <strong>RPC over BLE</strong>
                            <span>Allow local RPC calls through Bluetooth GATT.</span>
                        </div>
                        <CardToggle size="row"
                            v-model="local.rpcEnable"
                            aria-label="Enable RPC over BLE"
                            @update:model-value="markDirty"
                        />
                    </div>

                    <div v-if="hasObserver" class="ble-panel__setting">
                        <div class="ble-panel__setting-copy">
                            <strong>Observer mode</strong>
                            <span>Listen for BTHome and BLE advertisements.</span>
                        </div>
                        <CardToggle size="row"
                            v-model="local.observerEnable"
                            aria-label="Enable observer mode"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <p v-if="willDisableBle" class="ble-panel__notice" role="alert">
                    <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                    <span>
                        Mobile pairing and BTHome sensors will stop when
                        Bluetooth is disabled.
                    </span>
                </p>

                <ConfigPanelFooter
                    label="Bluetooth"
                    :dirty="panelDirty"
                    :saving="saving"
                    :restart-required="restartRequired"
                    :rebooting="rebooting"
                    :external-changed="externalConfigChanged"
                    @save="save"
                    @reboot="rebootDevice"
                    @refresh="reload"
                />
            </section>

            <section
                v-if="supportsPairing"
                id="ble-panel-pairing"
                class="ble-panel__view ble-panel__view--pairing"
                aria-labelledby="ble-pairing-title"
            >
                <header class="ble-panel__view-header">
                    <div>
                        <h4 id="ble-pairing-title">Pairing mode</h4>
                        <p>Let a phone or app connect securely to this device.</p>
                    </div>
                </header>

                <div class="ble-panel__pairing-state" role="status" aria-live="polite">
                    <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    <div>
                        <strong>{{ pairingStatusText }}</strong>
                        <span>{{ pairingStatusDetail }}</span>
                    </div>
                </div>

                <div class="ble-panel__pair-actions">
                    <Button
                        type="blue"
                        size="sm"
                        :loading="pairing"
                        :disabled="!local.enable || stopping"
                        @click="startPairing"
                    >
                        Start pairing
                    </Button>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="stopping"
                        :disabled="!local.enable || pairing"
                        @click="stopPairing"
                    >
                        Stop
                    </Button>
                </div>
            </section>

            <section
                v-if="supportsPairedList"
                id="ble-panel-devices"
                class="ble-panel__view"
                aria-labelledby="ble-devices-title"
            >
                <header class="ble-panel__view-header ble-panel__view-header--devices">
                    <div>
                        <h4 id="ble-devices-title">Bonded clients</h4>
                        <p>{{ pairedDevicesSummary }}</p>
                    </div>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        narrow
                        :loading="loadingPaired"
                        title="Refresh paired devices"
                        aria-label="Refresh paired devices"
                        @click="loadPaired"
                    >
                        <i class="fas fa-sync-alt" aria-hidden="true" />
                    </Button>
                </header>

                <div v-if="loadingPaired" class="ble-panel__empty" role="status">
                    <span>Loading paired devices…</span>
                </div>
                <div
                    v-else-if="pairedDevicesError"
                    class="ble-panel__empty ble-panel__empty--error"
                    role="status"
                >
                    <i class="fas fa-circle-exclamation" aria-hidden="true" />
                    <strong>Paired devices unavailable</strong>
                    <span>{{ pairedDevicesError }}</span>
                    <Button type="blue-hollow" size="sm" @click="loadPaired">
                        Retry
                    </Button>
                </div>
                <div v-else-if="pairedDevices.length === 0" class="ble-panel__empty">
                    <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    <strong>No bonded clients</strong>
                    <span>Phones and apps that pair with this device appear here.</span>
                </div>
                <ul v-else class="ble-panel__device-list" aria-label="Paired Bluetooth devices">
                    <li
                        v-for="d in pairedDevices"
                        :key="pairedKey(d)"
                        class="ble-panel__device"
                    >
                        <i class="fas fa-microchip" aria-hidden="true" />
                        <div class="ble-panel__device-copy">
                            <strong>{{ pairedTitle(d) }}</strong>
                            <span>{{ pairedSubtitle(d) }}</span>
                            <dl
                                v-if="pairedMetadata(d).length > 0"
                                class="ble-panel__device-metadata"
                            >
                                <div
                                    v-for="item in pairedMetadata(d)"
                                    :key="item.label"
                                >
                                    <dt>{{ item.label }}</dt>
                                    <dd>{{ item.value }}</dd>
                                </div>
                            </dl>
                        </div>
                        <div v-if="pendingRemoval === d" class="ble-panel__remove-confirm">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                @click="pendingRemoval = null"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="red"
                                size="sm"
                                :loading="removing"
                                @click="removePaired(d)"
                            >
                                Unpair
                            </Button>
                        </div>
                        <button
                            v-else
                            type="button"
                            class="ble-panel__remove"
                            :aria-label="`Remove ${pairedTitle(d)}`"
                            @click="pendingRemoval = d"
                        >
                            Remove
                        </button>
                    </li>
                </ul>
            </section>
        </form>

        <div v-else-if="refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else class="ble-panel__error">
            <p>Failed to load BLE configuration.</p>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="refetching"
                @click="refetch"
            >
                Retry
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {deviceSupports} from '@/helpers/device';
import {formatTime} from '@/helpers/format';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import CardToggle from '../cards/CardToggle.vue';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';

interface BleConfig {
    enable?: boolean;
    rpc?: {enable?: boolean};
    observer?: {enable?: boolean};
}

interface BleLocalForm {
    enable: boolean;
    rpcEnable: boolean;
    observerEnable: boolean;
}

interface PairedDevice {
    addr?: string;
    address?: string;
    atime?: number | string;
    battery?: number | string;
    last_seen?: number | string;
    lastSeen?: number | string;
    name?: string;
    rssi?: number | string;
    signal?: number | string;
    type?: string;
    [k: string]: unknown;
}

interface PairedDeviceMetadata {
    label: string;
    value: string;
}

const props = defineProps<{shellyID: string}>();
const emit = defineEmits<{'dirty-change': [dirty: boolean]}>();
const toast = useToastStore();
const deviceStore = useDevicesStore();

const hasObserver = ref(false);

// Pairing shipped on newer firmware only — hide what the device
// cannot do instead of surfacing "not supported" RPC errors.
const device = computed(() => deviceStore.devices[props.shellyID]);
const supportsPairing = computed(() =>
    deviceSupports(device.value, 'BLE.StartPairing')
);
const supportsPairedList = computed(() =>
    deviceSupports(device.value, 'BLE.ListPairedDevices')
);

const {
    config,
    local,
    dirty,
    saving,
    restartRequired,
    rebooting,
    externalConfigChanged,
    markDirty,
    save,
    rebootDevice,
    reload,
    refetch,
    refetching
} = useDeviceConfigPanel<BleConfig, BleLocalForm>({
        shellyID: () => props.shellyID,
        settingsKey: 'ble',
        method: 'Ble.SetConfig',
        initialLocal: {
            enable: false,
            rpcEnable: false,
            observerEnable: false
        },
        mapToLocal: (c) => {
            hasObserver.value = c.observer !== undefined;
            return {
                enable: c.enable ?? false,
                rpcEnable: c.rpc?.enable ?? false,
                observerEnable: c.observer?.enable ?? false
            };
        },
        mapToUpdate: (l) => {
            const u: BleConfig = {
                enable: l.enable,
                rpc: {enable: l.rpcEnable}
            };
            if (hasObserver.value) {
                u.observer = {enable: l.observerEnable};
            }
            return u;
        },
        successToast: 'Bluetooth configuration saved'
    });

const panelDirty = computed(() => dirty.value);

const willDisableBle = computed(
    () => config.value?.enable === true && local.enable === false
);

const pairing = ref(false);
const stopping = ref(false);
const pairedDevices = ref<PairedDevice[]>([]);
const loadingPaired = ref(false);
const pairedDevicesError = ref<string | null>(null);
const removing = ref(false);
const pendingRemoval = ref<PairedDevice | null>(null);
const pairedDevicesShellyID = ref<string | null>(null);
const pairingWindowOpen = ref<boolean | null>(null);
let pairedDevicesRequestGeneration = 0;
let pairingRequestGeneration = 0;
let stoppingRequestGeneration = 0;
let removePairedRequestGeneration = 0;

const pairingStatusText = computed(() => {
    if (!local.enable) return 'Bluetooth is off';
    if (pairing.value) return 'Opening pairing…';
    if (stopping.value) return 'Closing pairing…';
    if (pairingWindowOpen.value) return 'Pairing is active';
    return 'Ready to pair';
});

const pairingStatusDetail = computed(() => {
    if (!local.enable) return 'Turn on Bluetooth above first.';
    if (pairing.value) return 'Waiting for the gateway to open pairing.';
    if (stopping.value) return 'Waiting for the gateway to close pairing.';
    if (pairingWindowOpen.value) {
        return 'A phone or app can now connect and bond.';
    }
    return 'Start pairing, then connect from the phone or app within 3 minutes.';
});

const pairedDevicesSummary = computed(() => {
    if (loadingPaired.value) return 'Checking this gateway…';
    if (pairedDevicesError.value) return 'Unable to check this gateway';
    const count = pairedDevices.value.length;
    return count === 1
        ? '1 client is bonded with this device'
        : `${count} clients are bonded with this device`;
});

async function startPairing(): Promise<void> {
    const shellyID = props.shellyID;
    const generation = ++pairingRequestGeneration;
    pairing.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Ble.StartPairing', {
            shellyID
        });
        if (!isCurrentPairingRequest(generation, shellyID)) return;
        pairingWindowOpen.value = true;
        toast.success('Pairing window opened');
    } catch (err: unknown) {
        if (!isCurrentPairingRequest(generation, shellyID)) return;
        toast.error(rpcErrorMessage(err, 'Failed to open Bluetooth pairing'));
    } finally {
        if (isCurrentPairingRequest(generation, shellyID)) {
            pairing.value = false;
        }
    }
}

function isCurrentPairingRequest(
    generation: number,
    shellyID: string
): boolean {
    return generation === pairingRequestGeneration && shellyID === props.shellyID;
}

async function stopPairing(): Promise<void> {
    const shellyID = props.shellyID;
    const generation = ++stoppingRequestGeneration;
    stopping.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Ble.StopPairing', {
            shellyID
        });
        if (!isCurrentStoppingRequest(generation, shellyID)) return;
        pairingWindowOpen.value = false;
        toast.info('Pairing window closed');
    } catch (err: unknown) {
        if (!isCurrentStoppingRequest(generation, shellyID)) return;
        toast.error(rpcErrorMessage(err, 'Failed to close Bluetooth pairing'));
    } finally {
        if (isCurrentStoppingRequest(generation, shellyID)) {
            stopping.value = false;
        }
    }
}

function isCurrentStoppingRequest(
    generation: number,
    shellyID: string
): boolean {
    return generation === stoppingRequestGeneration && shellyID === props.shellyID;
}

async function loadPaired(): Promise<void> {
    if (!supportsPairedList.value) return;
    const shellyID = props.shellyID;
    const generation = ++pairedDevicesRequestGeneration;
    pairedDevices.value = [];
    pairedDevicesShellyID.value = null;
    pairedDevicesError.value = null;
    loadingPaired.value = true;
    try {
        const res = await sendRPC<{devices?: PairedDevice[]} | PairedDevice[]>(
            'FLEET_MANAGER',
            'Ble.ListPairedDevices',
            {shellyID}
        );
        if (!isCurrentPairedDevicesRequest(generation, shellyID)) return;
        pairedDevices.value = Array.isArray(res)
            ? res
            : (res?.devices ?? []);
        pairedDevicesShellyID.value = shellyID;
    } catch (err: unknown) {
        if (!isCurrentPairedDevicesRequest(generation, shellyID)) return;
        pairedDevicesError.value = rpcErrorMessage(
            err,
            'Failed to load paired devices'
        );
        pairedDevices.value = [];
    } finally {
        if (isCurrentPairedDevicesRequest(generation, shellyID)) {
            loadingPaired.value = false;
        }
    }
}

function isCurrentPairedDevicesRequest(
    generation: number,
    shellyID: string
): boolean {
    return (
        generation === pairedDevicesRequestGeneration &&
        shellyID === props.shellyID
    );
}

async function removePaired(d: PairedDevice): Promise<void> {
    const shellyID = pairedDevicesShellyID.value;
    if (
        !shellyID ||
        shellyID !== props.shellyID ||
        !pairedDevices.value.includes(d)
    ) {
        toast.error('Paired devices changed; refresh and try again');
        return;
    }
    const addr = d.addr ?? d.address;
    if (!addr) {
        toast.error('Missing peripheral address');
        return;
    }
    const generation = ++removePairedRequestGeneration;
    removing.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Ble.DeletePairedDevice', {
            shellyID,
            addr
        });
        if (!isCurrentRemovePairedRequest(generation, shellyID)) return;
        toast.success(`Unpaired ${addr}`);
        pendingRemoval.value = null;
        await loadPaired();
    } catch (err: unknown) {
        if (!isCurrentRemovePairedRequest(generation, shellyID)) return;
        toast.error(rpcErrorMessage(err, 'Failed to unpair Bluetooth device'));
    } finally {
        if (isCurrentRemovePairedRequest(generation, shellyID)) {
            removing.value = false;
        }
    }
}

function isCurrentRemovePairedRequest(
    generation: number,
    shellyID: string
): boolean {
    return (
        generation === removePairedRequestGeneration &&
        shellyID === props.shellyID
    );
}

function pairedKey(d: PairedDevice): string {
    return d.addr ?? d.address ?? JSON.stringify(d);
}

function pairedTitle(d: PairedDevice): string {
    return (d.name as string) || (d.type as string) || 'BLE peripheral';
}

function pairedSubtitle(d: PairedDevice): string {
    const address = (d.addr as string) ?? (d.address as string) ?? '';
    return address;
}

function pairedMetadata(d: PairedDevice): PairedDeviceMetadata[] {
    const metadata: PairedDeviceMetadata[] = [];
    if (d.name && hasDisplayValue(d.type)) {
        metadata.push({label: 'Type', value: String(d.type)});
    }

    const signal = pairedSignal(d);
    if (signal) metadata.push(signal);

    if (hasDisplayValue(d.battery)) {
        metadata.push({label: 'Battery', value: formatBattery(d.battery)});
    }

    const lastSeen = formatLastSeen(d.atime ?? d.last_seen ?? d.lastSeen);
    if (lastSeen) metadata.push({label: 'Last seen', value: lastSeen});
    return metadata;
}

function pairedSignal(d: PairedDevice): PairedDeviceMetadata | null {
    if (hasDisplayValue(d.rssi)) {
        const value = typeof d.rssi === 'number' ? `${d.rssi} dBm` : d.rssi;
        return {label: 'RSSI', value: String(value)};
    }
    if (hasDisplayValue(d.signal)) {
        return {label: 'Signal', value: String(d.signal)};
    }
    return null;
}

function formatBattery(value: number | string): string {
    return typeof value === 'number' ? `${value}%` : value;
}

function formatLastSeen(value: number | string | undefined): string | null {
    if (!hasDisplayValue(value)) return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric) && numeric <= 0) return null;
    const timestamp = Number.isFinite(numeric)
        ? numeric < 1_000_000_000_000
            ? numeric * 1000
            : numeric
        : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : formatTime(timestamp);
}

function hasDisplayValue(
    value: number | string | undefined
): value is number | string {
    return (
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.trim().length > 0)
    );
}

onMounted(loadPaired);
// device.methods can arrive after mount — load once support shows up.
watch(supportsPairedList, (supported) => {
    if (supported) void loadPaired();
});
watch(
    panelDirty,
    (value) => {
        emit('dirty-change', value);
    },
    {immediate: true}
);
watch(
    () => props.shellyID,
    () => {
        pairingRequestGeneration++;
        stoppingRequestGeneration++;
        removePairedRequestGeneration++;
        pairing.value = false;
        stopping.value = false;
        removing.value = false;
        pendingRemoval.value = null;
        pairingWindowOpen.value = null;
        void loadPaired();
    }
);
</script>

<style scoped>
.ble-panel,
.ble-panel form {
    display: grid;
    gap: var(--gap-md);
    min-width: 0;
}

/* Amber = unsaved, everywhere; rounded square like the shell's nav dot. */
.ble-panel__dirty-dot {
    width: var(--gap-xs);
    height: var(--gap-xs);
    flex: 0 0 var(--gap-xs);
    border-radius: var(--radius-sm);
    background: var(--color-warning-text);
}

.ble-panel__setting-copy,
.ble-panel__device-copy,
.ble-panel__pairing-state > div {
    display: grid;
    gap: var(--gap-xs);
    min-width: 0;
}

.ble-panel__setting-copy strong,
.ble-panel__device-copy strong,
.ble-panel__pairing-state strong,
.ble-panel__empty strong {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
}

.ble-panel__setting-copy span,
.ble-panel__device-copy span,
.ble-panel__pairing-state span,
.ble-panel__empty span {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.ble-panel__remove:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}


/* Stacked section cards — same language as every other settings page. */
.ble-panel__view {
    display: grid;
    gap: var(--gap-md);
    min-width: 0;
    outline: none;
    padding: var(--space-2) var(--space-4) var(--space-3);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
}

.ble-panel__view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-md);
}

.ble-panel__view-header h4,
.ble-panel__view-header p {
    margin: 0;
}

.ble-panel__view-header h4 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
}

.ble-panel__view-header p {
    margin-top: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.ble-panel__setting-list,
.ble-panel__device-list {
    display: grid;
    margin: 0;
    padding: 0 var(--gap-md);
    list-style: none;
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
}

.ble-panel__setting,
.ble-panel__device {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-md);
    min-height: var(--touch-target-min);
    padding: var(--gap-sm) 0;
    border-bottom: 1px solid var(--color-border-subtle);
}

.ble-panel__setting:last-child,
.ble-panel__device:last-child {
    border-bottom: 0;
}

.ble-panel__notice {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-sm);
    margin: 0;
    padding: var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-warning-subtle);
    color: var(--color-warning-text);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.ble-panel__notice i {
    margin-top: var(--gap-xs);
}

.ble-panel__view--pairing {
    align-content: start;
}

.ble-panel__pairing-state {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    min-height: var(--touch-target-min);
    padding: var(--gap-md);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
}

.ble-panel__pairing-state > i {
    width: var(--icon-size-lg);
    color: var(--color-primary-text);
    font-size: var(--icon-size-lg);
    text-align: center;
}

.ble-panel__pair-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
}

.ble-panel__empty {
    display: grid;
    justify-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-lg) var(--gap-md);
    text-align: center;
}

.ble-panel__empty > i {
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-lg);
}

.ble-panel__device > i {
    width: var(--icon-size-md);
    flex: 0 0 var(--icon-size-md);
    color: var(--color-text-tertiary);
    text-align: center;
}

.ble-panel__device-copy {
    flex: 1;
}

.ble-panel__device-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs) var(--gap-sm);
    margin: 0;
}

.ble-panel__device-metadata > div {
    display: inline-flex;
    gap: var(--gap-xs);
    min-width: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.ble-panel__device-metadata dt {
    font-weight: var(--font-semibold);
}

.ble-panel__device-metadata dd {
    margin: 0;
    color: var(--color-text-secondary);
}

.ble-panel__remove {
    min-height: var(--touch-target-min);
    padding: var(--gap-xs);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-danger-text);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--motion-hover);
}

.ble-panel__remove:hover {
    background: var(--color-danger-subtle);
}

.ble-panel__remove-confirm {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}

.ble-panel__error {
    display: grid;
    justify-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    color: var(--color-text-tertiary);
    text-align: center;
}

.ble-panel__error p {
    margin: 0;
}

.ble-panel__empty--error > i {
    color: var(--color-danger-text);
}

/* Single modal-wide mobile breakpoint — keep in sync with the
   device-settings shell in DeviceBoard.vue (767px). */
@media (max-width: 767px) {
    .ble-panel__view-header--devices {
        align-items: stretch;
    }
}
</style>
