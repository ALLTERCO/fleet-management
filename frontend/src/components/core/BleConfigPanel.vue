<template>
    <div class="cfg-panel">
        <form v-if="config" @submit.prevent autocomplete="off">
            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Enable Bluetooth</strong>
                    <span>Master toggle for the device's BLE radio</span>
                </div>
                <Checkbox v-model="local.enable" @update:model-value="markDirty" />
            </div>

            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>RPC over BLE</strong>
                    <span>Allow RPC calls via Bluetooth GATT</span>
                </div>
                <Checkbox v-model="local.rpcEnable" @update:model-value="markDirty" />
            </div>

            <div v-if="hasObserver" class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Observer mode</strong>
                    <span>Listen for nearby BTHome / BLE advertisements</span>
                </div>
                <Checkbox v-model="local.observerEnable" @update:model-value="markDirty" />
            </div>

            <p v-if="willDisableBle" class="cfg-panel__notice">
                <i class="fas fa-triangle-exclamation" />
                Disabling BLE blocks FMA mobile-app pairing and stops BTHome
                sensors paired through this gateway.
            </p>

            <div v-if="dirty" class="cfg-panel__footer">
                <Button type="blue" size="sm" :loading="saving" @click="save">
                    Save
                </Button>
            </div>

            <div class="cfg-panel__section-label">Pairing</div>
            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Pairing window</strong>
                    <span>Allow new BLE devices to pair with this gateway</span>
                </div>
                <div class="ble-panel__pair-actions">
                    <Button
                        type="green"
                        size="sm"
                        :loading="pairing"
                        :disabled="!local.enable"
                        @click="startPairing"
                    >
                        <i class="fas fa-bluetooth-b" /> Start
                    </Button>
                    <Button
                        type="red"
                        size="sm"
                        :loading="stopping"
                        :disabled="!local.enable"
                        @click="stopPairing"
                    >
                        Stop
                    </Button>
                </div>
            </div>

            <div class="cfg-panel__section-label">Paired peripherals</div>
            <div v-if="loadingPaired" class="cfg-panel__row">
                <span class="ble-panel__muted">Loading…</span>
            </div>
            <div v-else-if="pairedDevices.length === 0" class="cfg-panel__row">
                <span class="ble-panel__muted">
                    No paired BLE devices on this gateway.
                </span>
                <Button type="blue-hollow" size="sm" title="Refresh" aria-label="Refresh" @click="loadPaired"><i class="fas fa-sync-alt" /></Button>
            </div>
            <template v-else>
                <div
                    v-for="d in pairedDevices"
                    :key="pairedKey(d)"
                    class="cfg-panel__row"
                >
                    <div class="cfg-panel__row-label">
                        <strong>{{ pairedTitle(d) }}</strong>
                        <span>{{ pairedSubtitle(d) }}</span>
                    </div>
                    <Button
                        type="red"
                        size="sm"
                        @click="removePaired(d)"
                    >
                        Remove
                    </Button>
                </div>
                <div class="cfg-panel__row">
                    <Button type="blue-hollow" size="sm" title="Refresh" aria-label="Refresh" @click="loadPaired"><i class="fas fa-sync-alt" /></Button>
                </div>
            </template>
        </form>

        <div v-else class="cfg-panel__error">
            <p>Failed to load BLE configuration.</p>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';

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
    name?: string;
    type?: string;
    [k: string]: unknown;
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();

const hasObserver = ref(false);

const {config, local, dirty, saving, markDirty, save, reload} =
    useDeviceConfigPanel<BleConfig, BleLocalForm>({
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

const willDisableBle = computed(
    () => config.value?.enable === true && local.enable === false
);

const pairing = ref(false);
const stopping = ref(false);
const pairedDevices = ref<PairedDevice[]>([]);
const loadingPaired = ref(false);

async function startPairing(): Promise<void> {
    pairing.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Ble.StartPairing', {
            shellyID: props.shellyID
        });
        toast.success('Pairing window opened');
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
    } finally {
        pairing.value = false;
    }
}

async function stopPairing(): Promise<void> {
    stopping.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Ble.StopPairing', {
            shellyID: props.shellyID
        });
        toast.info('Pairing window closed');
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
    } finally {
        stopping.value = false;
    }
}

async function loadPaired(): Promise<void> {
    loadingPaired.value = true;
    try {
        const res = await sendRPC<{devices?: PairedDevice[]} | PairedDevice[]>(
            'FLEET_MANAGER',
            'Ble.ListPairedDevices',
            {shellyID: props.shellyID}
        );
        pairedDevices.value = Array.isArray(res)
            ? res
            : (res?.devices ?? []);
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
        pairedDevices.value = [];
    } finally {
        loadingPaired.value = false;
    }
}

async function removePaired(d: PairedDevice): Promise<void> {
    const addr = d.addr ?? d.address;
    if (!addr) {
        toast.error('Missing peripheral address');
        return;
    }
    if (!confirm(`Unpair ${pairedTitle(d)} (${addr})?`)) return;
    try {
        await sendRPC('FLEET_MANAGER', 'Ble.DeletePairedDevice', {
            shellyID: props.shellyID,
            addr
        });
        toast.success(`Unpaired ${addr}`);
        await loadPaired();
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
    }
}

function pairedKey(d: PairedDevice): string {
    return d.addr ?? d.address ?? JSON.stringify(d);
}

function pairedTitle(d: PairedDevice): string {
    return (d.name as string) || (d.type as string) || 'BLE peripheral';
}

function pairedSubtitle(d: PairedDevice): string {
    return (d.addr as string) ?? (d.address as string) ?? '';
}

onMounted(loadPaired);
watch(
    () => props.shellyID,
    () => void loadPaired()
);
</script>

<style scoped>
.ble-panel__pair-actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
}

.ble-panel__muted {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
