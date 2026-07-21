<template>
    <div class="bth">
        <!-- Paired devices -->
        <div v-if="loading" class="bth__loading"><Spinner size="sm" /></div>

        <div v-else-if="pairedDevices.length > 0" class="bth__section">
            <div class="bth__section-header">Paired devices ({{ pairedDevices.length }})</div>
            <div class="bth__list">
                <div v-for="dev in pairedDevices" :key="dev.id" class="bth__device">
                    <div class="bth__device-row" @click="toggleExpand(dev.id)">
                        <i class="fab fa-bluetooth-b bth__bt-icon" />
                        <div class="bth__device-info">
                            <span class="bth__device-name">{{ dev.name || dev.productName || dev.addr }}</span>
                            <span v-if="dev.name || dev.productName" class="bth__device-addr">{{ dev.addr }}{{ dev.modelId ? ` · ${dev.modelId}` : '' }}</span>
                        </div>
                        <span v-if="dev.battery != null" class="bth__device-badge" :title="`Battery: ${dev.battery}%`">
                            <i class="fas fa-battery-half" /> {{ dev.battery }}%
                        </span>
                        <span v-if="dev.rssi != null" class="bth__device-badge" :title="`RSSI: ${dev.rssi} dBm`">
                            <i class="fas fa-signal" /> {{ dev.rssi }}
                        </span>
                        <span
                            v-if="deviceErrors[dev.id]?.length"
                            class="bth__device-badge bth__badge--error"
                            :title="deviceErrors[dev.id].join(', ').replace(/_/g, ' ')"
                        >
                            <i class="fas fa-key" /> Encryption error
                        </span>
                        <span class="bth__device-sensors">{{ dev.sensorCount }} sensors</span>
                        <i class="fas bth__chevron" :class="expandedDevice === dev.id ? 'fa-chevron-up' : 'fa-chevron-down'" />
                    </div>

                    <!-- Expanded: known objects + sensors -->
                    <div v-if="expandedDevice === dev.id" class="bth__objects">
                        <div v-if="loadingObjects" class="bth__loading"><Spinner size="sm" /></div>
                        <template v-else>
                            <div v-for="obj in knownObjects" :key="`${obj.obj_id}-${obj.idx}`" class="bth__obj-row">
                                <span class="bth__obj-name">{{ getObjDisplayLabel(obj.obj_id, obj.idx) }}</span>
                                <span v-if="obj.component" class="bth__obj-assigned">
                                    {{ obj.component }}
                                    <button class="bth__obj-remove" title="Remove sensor" aria-label="Remove sensor" @click.stop="deleteSensor(obj)">
                                        <i class="fas fa-trash" />
                                    </button>
                                </span>
                                <span v-else-if="isDeviceLevelEvent(obj.obj_id)" class="bth__obj-device-event">
                                    Device event
                                </span>
                                <Button v-else type="green" size="sm" :loading="addingSensor" @click="addSensor(dev, obj)">
                                    Add
                                </Button>
                            </div>
                            <div v-if="knownObjects.length === 0" class="bth__empty">
                                Waiting for device to broadcast... (can take up to 60s)
                                <Button type="blue-hollow" size="sm" @click="refreshExpandedObjects(dev.id)">
                                    Retry
                                </Button>
                            </div>
                        </template>

                        <!-- Encryption error notice -->
                        <div v-if="deviceErrors[dev.id]?.length" class="bth__encrypt-row">
                            <span class="bth__encrypt-error">
                                <i class="fas fa-lock-open" />
                                {{ deviceErrors[dev.id].join(' · ').replace(/_/g, ' ') }}
                            </span>
                            <Button type="blue" size="sm" @click="setDeviceKey(dev)">
                                Set Key
                            </Button>
                        </div>

                        <div class="bth__device-actions">
                            <Button v-if="unassignedObjects.length > 0" type="green" size="sm" :loading="addingSensor" @click="addAllSensors(dev)">
                                Add all ({{ unassignedObjects.length }})
                            </Button>
                            <Button type="blue-hollow" size="sm" @click="renameDevice(dev)">
                                Rename
                            </Button>
                            <Button type="red" size="sm" @click="deleteDevice(dev.id)">
                                Remove
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div v-else class="cfg-panel__empty">
            <i class="fab fa-bluetooth-b" aria-hidden="true" />
            <strong>No devices assigned yet</strong>
            <span>Pair nearby Bluetooth sensors and remotes to this device.</span>
        </div>

        <!-- Add device -->
        <div class="bth__section">
            <div class="bth__section-header">Add device</div>
            <div class="bth__add-row">
                <input
                    v-model="newDeviceAddr"
                    class="bth__input"
                    placeholder="MAC address (e.g. AA:BB:CC:DD:EE:FF)"
                    @keyup.enter="addDevice"
                />
                <Button type="blue" size="sm" :loading="addingDevice" @click="addDevice">
                    Pair
                </Button>
                <Button type="blue-hollow" size="sm" :loading="scanning" :disabled="scanning" @click="startScan">
                    <template v-if="scanning">Scanning...</template>
                    <template v-else>Scan for devices</template>
                </Button>
            </div>

            <!-- Discovered devices from scan -->
            <div v-if="discoveredDevices.length > 0" class="bth__discovered">
                <div class="bth__section-header">Discovered ({{ discoveredDevices.length }})</div>
                <div class="bth__list">
                    <div v-for="dev in discoveredDevices" :key="dev.mac" class="bth__device">
                        <div class="bth__device-row">
                            <i class="fab fa-bluetooth-b bth__bt-icon bth__bt-icon--discovered" />
                            <div class="bth__device-info">
                                <span class="bth__device-name">{{ getDiscoveredDeviceTitle(dev) }}</span>
                                <span class="bth__device-addr">{{ getDiscoveredDeviceDetails(dev) }}</span>
                            </div>
                            <span v-if="dev.isRemote" class="bth__device-badge" title="Supports BLE Controls learning">
                                <i class="fas fa-graduation-cap" /> Controls
                            </span>
                            <span v-if="dev.rssi != null" class="bth__device-badge" :title="`RSSI: ${dev.rssi} dBm`">
                                <i class="fas fa-signal" /> {{ dev.rssi }}
                            </span>
                            <Button type="blue" size="sm" :loading="pairingMac === dev.mac" :disabled="!!pairingMac" @click="pairDiscovered(dev.mac)">
                                Pair
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

            <!-- BLE Controls: learned remote bindings + learn new -->
            <div v-if="deviceInputs.length > 0 && (hasRemoteDevices || controlBindings.length > 0)" class="bth__section">
                <div class="bth__section-header">BLE controls</div>

                <!-- Existing bindings from device -->
                <div v-if="loadingControls" class="bth__loading"><Spinner size="sm" /></div>
                <div v-else-if="controlBindings.length > 0" class="bth__list">
                    <div
                        v-for="binding in controlBindings"
                        :key="binding.id"
                        class="bth__device"
                    >
                        <div class="bth__control-row">
                            <div class="bth__device-info">
                                <span class="bth__device-name">{{ binding.key }}</span>
                                <template v-if="binding.inputs?.length">
                                    <span
                                        v-for="(inp, i) in binding.inputs"
                                        :key="i"
                                        class="bth__device-addr"
                                    >{{ getBTHomeDeviceName(inp.bthomedevice) }} · {{ formatControlEvent(inp) }}</span>
                                </template>
                                <span v-else class="bth__device-addr">No inputs configured</span>
                            </div>
                            <button
                                class="bth__obj-remove"
                                title="Remove all mappings for this binding"
                                @click="deleteControl(binding.id)"
                            >
                                <i class="fas fa-trash" />
                            </button>
                        </div>
                    </div>
                </div>
                <div v-else class="bth__empty">No BLE control bindings yet.</div>

                <!-- Learn new binding -->
                <div class="bth__add-row">
                    <template v-if="!learning">
                        <select v-model="learningInputId" class="bth__input bth__input--select">
                            <option v-for="inp in deviceInputs" :key="inp.id" :value="inp.id">
                                Input {{ inp.id }}{{ inp.name ? ` — ${inp.name}` : '' }}
                            </option>
                        </select>
                        <Button type="blue-hollow" size="sm" :loading="learningStarting" :disabled="learningStarting" @click="startLearning">
                            Learn
                        </Button>
                    </template>
                    <template v-else>
                        <div class="bth__scan-status">
                            <Spinner size="sm" /> {{ learningStageLabel }}
                        </div>
                        <Button type="blue-hollow" size="sm" @click="stopLearning">
                            Stop
                        </Button>
                    </template>
                </div>
            </div>

    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {bluetoothDevices} from '@/shell/template-host';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import {
    type BTHomeControlLearningEvent,
    type BTHomeDiscoveryEvent,
    type BTHomeLearningState,
    onBTHomeControlLearning,
    onBTHomeControlsUpdated,
    onBTHomeDiscovery,
    onBTHomeDone
} from '@/tools/websocket';
import Button from './Button.vue';
import Spinner from './Spinner.vue';

const props = defineProps<{
    shellyID: string;
}>();

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const toast = useToastStore();

const loading = ref(true);
const scanning = ref(false);
const addingDevice = ref(false);
const pairingMac = ref<string | null>(null);
const addingSensor = ref(false);
const loadingObjects = ref(false);
const newDeviceAddr = ref('');
const expandedDevice = ref<number | null>(null);

type PairedDevice = {
    id: number;
    addr: string;
    name: string | null;
    productName: string | null;
    modelId: string | null;
    sensorCount: number;
    battery: number | null;
    rssi: number | null;
};

type KnownObj = {
    obj_id: number;
    idx: number;
    component: string | null;
};

const pairedDevices = ref<PairedDevice[]>([]);
const knownObjects = ref<KnownObj[]>([]);
const discoveredDevices = ref<BTHomeDiscoveryEvent[]>([]);

// Show BTHomeControl learning if any discovered or paired BLE device is a remote
// (has button/dimmer controls). Read from entity store — the backend sets
// controls[] on every bthomedevice entity from BTHomeDevice.GetKnownObjects.
const hasRemoteDevices = computed(() => {
    if (discoveredDevices.value.some((d) => d.isRemote)) return true;
    return Object.values(entityStore.entities).some(
        (e) =>
            e.type === 'bthomedevice' &&
            e.source === props.shellyID &&
            Array.isArray((e.properties as any).controls) &&
            (e.properties as any).controls.length > 0
    );
});

// Per-device encryption errors from the entity store (live from device status).
const deviceErrors = computed(() => {
    const result: Record<number, string[]> = {};
    for (const e of Object.values(entityStore.entities)) {
        if (e.type !== 'bthomedevice' || e.source !== props.shellyID) continue;
        const p = e.properties as any;
        if (typeof p.id === 'number' && Array.isArray(p.errors) && p.errors.length > 0) {
            result[p.id] = p.errors;
        }
    }
    return result;
});

// Objects not yet assigned to a sensor — for "Add all" button
const unassignedObjects = computed(() =>
    knownObjects.value.filter(
        (o) => !o.component && !isDeviceLevelEvent(o.obj_id)
    )
);

async function loadPairedDevices() {
    loading.value = true;
    try {
        const dev = deviceStore.devices[props.shellyID];
        if (!dev) return;

        const devices: PairedDevice[] = [];
        const settings = dev.settings ?? {};
        const status = dev.status ?? {};

        // Pre-compute sensor count per address in one pass
        const sensorsByAddr: Record<string, number> = {};
        for (const key of Object.keys(settings)) {
            if (!key.startsWith('bthomesensor:')) continue;
            const addr = settings[key]?.addr;
            if (addr) sensorsByAddr[addr] = (sensorsByAddr[addr] ?? 0) + 1;
        }

        for (const key of Object.keys(settings)) {
            if (!key.startsWith('bthomedevice:')) continue;
            const cfg = settings[key];
            const id = cfg?.id ?? Number.parseInt(key.split(':')[1], 10);
            const devStatus = status[key] ?? {};
            devices.push({
                id,
                addr: cfg?.addr ?? '?',
                name: cfg?.name ?? null,
                productName: cfg?.meta?.productName ?? null,
                modelId: cfg?.meta?.modelId ?? null,
                sensorCount: sensorsByAddr[cfg?.addr] ?? 0,
                battery:
                    typeof devStatus?.battery === 'number'
                        ? devStatus.battery
                        : null,
                rssi:
                    typeof devStatus?.rssi === 'number' ? devStatus.rssi : null
            });
        }
        pairedDevices.value = devices;
    } finally {
        loading.value = false;
    }
}

/** Wait for the device store settings to update after an RPC that changes config.
 *  The event chain (device → FM → WS → store) typically takes <1s on LAN. */
let settingsWaitTimer: ReturnType<typeof setTimeout> | undefined;
function waitForSettingsUpdate(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
        const stopWatch = watch(
            () => deviceStore.devices[props.shellyID]?.settings,
            () => {
                stopWatch();
                cleanup();
                resolve();
            },
            {deep: true}
        );
        function cleanup() {
            if (settingsWaitTimer) {
                clearTimeout(settingsWaitTimer);
                settingsWaitTimer = undefined;
            }
        }
        settingsWaitTimer = setTimeout(() => {
            stopWatch();
            settingsWaitTimer = undefined;
            resolve();
        }, timeoutMs);
    });
}

// Object name cache — queried from device via BTHome.GetObjectInfos, not hardcoded
const objNameCache = new Map<number, string>();

async function fetchObjNames(objIds: number[]) {
    // Only fetch IDs we don't have yet
    const missing = objIds.filter((id) => !objNameCache.has(id));
    if (missing.length === 0) return;
    try {
        const resp = await ws.sendRPC(
            'FLEET_MANAGER',
            'BTHome.Object.ListInfos',
            {shellyID: props.shellyID, objIds: missing}
        );
        for (const obj of resp?.objects ?? []) {
            const name = (obj.obj_name ?? '').replace(/_/g, ' ');
            objNameCache.set(
                obj.obj_id,
                name.charAt(0).toUpperCase() + name.slice(1)
            );
        }
    } catch {
        // Fallback — device might not support GetObjectInfos
    }
}

function getObjName(objId: number): string {
    return objNameCache.get(objId) ?? `Sensor ${objId}`;
}

function getObjDisplayLabel(objId: number, idx: number): string {
    const baseName = getObjName(objId);
    const siblings = knownObjects.value.filter((o) => o.obj_id === objId);
    return siblings.length > 1 ? `${baseName} ${idx + 1}` : baseName;
}

function getDiscoveredDeviceTitle(dev: BTHomeDiscoveryEvent): string {
    return (
        dev.productName?.trim() ||
        dev.name?.trim() ||
        dev.localName?.trim() ||
        dev.modelString?.trim() ||
        dev.type ||
        dev.mac
    );
}

function uniqueDiscoveryDetails(values: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const details: string[] = [];

    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        const normalized = trimmed.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        details.push(trimmed);
    }

    return details;
}

function getDiscoveredDeviceDetails(dev: BTHomeDiscoveryEvent): string {
    const title = getDiscoveredDeviceTitle(dev);
    const details = uniqueDiscoveryDetails([
        dev.localName?.trim() && dev.localName.trim() !== title
            ? dev.localName.trim()
            : undefined,
        dev.modelString?.trim() && dev.modelString.trim() !== title
            ? dev.modelString.trim()
            : undefined,
        dev.mac
    ]);

    return details.join(' / ');
}

function resolveConfiguredComponent(
    addr: string,
    objId: number,
    idx: number
): string | null {
    const settings = deviceStore.devices[props.shellyID]?.settings ?? {};
    for (const [key, cfg] of Object.entries(settings)) {
        if (!key.startsWith('bthomesensor:')) continue;
        if (cfg?.addr !== addr) continue;
        if (cfg?.obj_id !== objId) continue;
        if (cfg?.idx !== idx) continue;
        return key;
    }
    return null;
}

// Check if an object is a device-level event (not addable as sensor)
// Uses the `deviceLevelEvents` flag set by the backend on the bthomedevice entity
function isDeviceLevelEvent(objId: number): boolean {
    const dev = deviceStore.devices[props.shellyID];
    if (!dev) return false;
    // Backend tags event-only obj_ids in bthomedevice entity properties
    const deviceEntities = Object.values(entityStore.entities).filter(
        (e) => e.type === 'bthomedevice' && e.source === props.shellyID
    );
    for (const de of deviceEntities) {
        const eventObjIds: number[] = (de.properties as any)?.eventObjIds ?? [];
        if (eventObjIds.includes(objId)) return true;
    }
    return false;
}

let expandRequestId = 0;

async function refreshExpandedObjects(id: number) {
    const requestId = ++expandRequestId;
    loadingObjects.value = true;
    try {
        const resp = await ws.sendRPC(
            'FLEET_MANAGER',
            'BTHome.Device.GetKnownObjects',
            {shellyID: props.shellyID, id}
        );
        // Discard stale response if user toggled to a different device while loading
        if (requestId !== expandRequestId) return;
        const objects = resp?.objects ?? [];
        const objIds = objects.map((o: any) => o.obj_id);
        await fetchObjNames(objIds);
        if (requestId !== expandRequestId) return;
        const addr =
            deviceStore.devices[props.shellyID]?.settings?.[
                `bthomedevice:${id}`
            ]?.addr ?? '';
        knownObjects.value = objects.map((obj: any) => ({
            obj_id: obj.obj_id,
            idx: obj.idx,
            component:
                obj.component ??
                (addr
                    ? resolveConfiguredComponent(addr, obj.obj_id, obj.idx)
                    : null)
        }));
    } catch (err: any) {
        if (requestId !== expandRequestId) return;
        toast.error(rpcErrorMessage(err, 'Failed to load objects'));
        knownObjects.value = [];
    } finally {
        if (requestId === expandRequestId) loadingObjects.value = false;
    }
}

async function toggleExpand(id: number) {
    if (expandedDevice.value === id) {
        expandedDevice.value = null;
        return;
    }
    expandedDevice.value = id;
    await refreshExpandedObjects(id);
}

async function addDevice() {
    const addr = newDeviceAddr.value.trim().toUpperCase();
    if (!addr) return;
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(addr)) {
        toast.error('Invalid MAC address format (e.g. AA:BB:CC:DD:EE:FF)');
        return;
    }
    addingDevice.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Device.AddManual', {
            shellyID: props.shellyID,
            mac: addr
        });
        toast.success(`Device ${addr} paired`);
        newDeviceAddr.value = '';
        await waitForSettingsUpdate();
        await loadPairedDevices();
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to pair device'));
    } finally {
        addingDevice.value = false;
    }
}

async function deleteDevice(id: number) {
    const dev = pairedDevices.value.find((d) => d.id === id);
    if (
        !confirm(
            `Remove ${dev?.name || dev?.productName || dev?.addr || `#${id}`} and all its sensors?`
        )
    )
        return;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Device.Remove', {
            shellyID: props.shellyID,
            id
        });
        toast.info('Device removed');
        expandedDevice.value = null;
        // Optimistic removal — Shelly.Settings event doesn't fire for component_removed
        pairedDevices.value = pairedDevices.value.filter((d) => d.id !== id);
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to remove device'));
        // Reload to restore the correct state
        await loadPairedDevices();
    }
}

async function renameDevice(dev: PairedDevice) {
    const newName = prompt('Device name:', dev.name ?? dev.addr);
    if (newName === null) return;
    try {
        await bluetoothDevices.renameGatewayChild({
            shellyID: props.shellyID,
            id: dev.id,
            name: newName.trim() || null
        });
        toast.success('Device renamed');
        await waitForSettingsUpdate();
        await loadPairedDevices();
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to rename device'));
    }
}

async function addAllSensors(dev: PairedDevice) {
    const toAdd = unassignedObjects.value;
    if (toAdd.length === 0) return;
    addingSensor.value = true;
    let added = 0;
    let skipped = 0;
    let firstError = '';
    try {
        for (const obj of toAdd) {
            try {
                await ws.sendRPC('FLEET_MANAGER', 'BTHome.Sensor.Add', {
                    shellyID: props.shellyID,
                    addr: dev.addr,
                    obj_id: obj.obj_id,
                    idx: obj.idx,
                    id: obj.obj_id
                });
                added++;
            } catch (err: any) {
                const msg = err?.message ?? '';
                if (msg.includes('already exists')) {
                    skipped++;
                    continue;
                }
                firstError ||= msg || 'Failed to add sensor';
            }
        }
        await refreshExpandedObjects(dev.id);
        dev.sensorCount += added;
        if (added > 0) {
            toast.success(`Added ${added} sensor${added > 1 ? 's' : ''}`);
        } else if (skipped > 0) {
            toast.info('All eligible sensors were already configured');
        }
        if (firstError) {
            toast.error(firstError);
        }
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, `Failed after adding ${added} sensors`));
        if (added > 0) {
            await refreshExpandedObjects(dev.id);
            dev.sensorCount += added;
        }
    } finally {
        addingSensor.value = false;
    }
}

async function addSensor(dev: PairedDevice, obj: KnownObj) {
    addingSensor.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Sensor.Add', {
            shellyID: props.shellyID,
            addr: dev.addr,
            obj_id: obj.obj_id,
            idx: obj.idx,
            id: obj.obj_id
        });
        toast.success('Sensor added');
        dev.sensorCount++;
    } catch (err: any) {
        const msg = err?.message ?? '';
        if (msg.includes('already exists')) {
            toast.info('Sensor already configured');
        } else {
            toast.error(msg || 'Failed to add sensor');
        }
    } finally {
        await refreshExpandedObjects(dev.id).catch(() => {});
        addingSensor.value = false;
    }
}

async function deleteSensor(obj: KnownObj) {
    if (!obj.component) return;
    // Extract sensor ID from component string (e.g., "bthomesensor:200")
    const match = obj.component.match(/:(\d+)$/);
    if (!match) {
        toast.error('Cannot determine sensor ID');
        return;
    }
    const sensorId = Number.parseInt(match[1], 10);
    if (!confirm(`Remove sensor ${getObjName(obj.obj_id)}?`)) return;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Sensor.Delete', {
            shellyID: props.shellyID,
            id: sensorId
        });
        toast.info('Sensor removed');
        if (expandedDevice.value != null)
            await refreshExpandedObjects(expandedDevice.value);
        // Optimistic sensor count update — Shelly.Settings doesn't fire for component_removed
        const parentDev = pairedDevices.value.find(
            (d) => d.id === expandedDevice.value
        );
        if (parentDev)
            parentDev.sensorCount = Math.max(0, parentDev.sensorCount - 1);
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to remove sensor'));
        // Refresh to restore correct state
        if (expandedDevice.value != null)
            await refreshExpandedObjects(expandedDevice.value);
    }
}

// BLE Control learning + bindings — fully backend-driven.
// Backend owns learning state, polls device, and broadcasts via WS.
// Frontend subscribes and reads cached bindings list from RPC.
const learningStarting = ref(false);
const learningInputId = ref(0);
const learningState = ref<BTHomeLearningState | null>(null);
const learning = computed(() => learningState.value !== null);

type BTHomeControlInput = {
    bthomedevice: string;
    obj_id: string;
    event: string;
    action: string;
};
type BTHomeControlBinding = {
    id: number;
    key: string;
    inputs: BTHomeControlInput[];
};
const controlBindings = ref<BTHomeControlBinding[]>([]);
const loadingControls = ref(false);

let unsubscribeLearning: (() => void) | null = null;
let unsubscribeControlsUpdated: (() => void) | null = null;

type DeviceInput = {id: number; name: string | null};
const deviceInputs = ref<DeviceInput[]>([]);

function loadDeviceInputs() {
    const dev = deviceStore.devices[props.shellyID];
    if (!dev) return;
    const settings = dev.settings ?? {};
    const inputs: DeviceInput[] = [];
    for (const key of Object.keys(settings)) {
        if (!key.startsWith('input:')) continue;
        const cfg = settings[key];
        inputs.push({
            id: cfg?.id ?? Number.parseInt(key.split(':')[1], 10),
            name: cfg?.name ?? null
        });
    }
    deviceInputs.value = inputs;
    if (
        inputs.length > 0 &&
        !inputs.some((i) => i.id === learningInputId.value)
    ) {
        learningInputId.value = inputs[0].id;
    }
}

const LEARNING_STAGE_LABELS: Record<string, string> = {
    pairing: 'Connecting to BLE device...',
    press: 'Press a button on your remote',
    done: 'Done!',
    remove: 'Removing binding...',
    error: 'Error'
};

const learningStageLabel = computed(() => {
    const state = learningState.value;
    if (!state) return `Learning on Input ${learningInputId.value}...`;
    if (state.stage === 'error') {
        return `Error: ${state.err?.msg ?? 'Learning failed'}`;
    }
    if (!state.stage) return `Learning on Input ${state.inputId}...`;
    return LEARNING_STAGE_LABELS[state.stage] ?? `Learning on Input ${state.inputId}...`;
});

async function startLearning() {
    learningStarting.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Control.StartLearning', {
            shellyID: props.shellyID,
            inputId: learningInputId.value
        });
        // No local state change — backend emits BTHome.ControlLearning which
        // our subscription below picks up and drives the UI.
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to start learning'));
    } finally {
        learningStarting.value = false;
    }
}

async function stopLearning() {
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Control.StopLearning', {
            shellyID: props.shellyID
        });
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to stop learning'));
    }
}

async function loadControls() {
    loadingControls.value = true;
    try {
        const resp = await ws.sendRPC('FLEET_MANAGER', 'BTHome.Control.List', {
            shellyID: props.shellyID
        });
        controlBindings.value = Array.isArray(resp?.bindings)
            ? resp.bindings
            : [];
    } catch {
        // Silent fail: device may not support BTHomeControl or may be offline.
        controlBindings.value = [];
    } finally {
        loadingControls.value = false;
    }
}

function handleLearningEvent(ev: BTHomeControlLearningEvent) {
    if (ev.shellyID !== props.shellyID) return;
    const prevStage = learningState.value?.stage ?? null;
    learningState.value = ev.state;
    if (ev.state === null) {
        // Backend cleared learning (done, error, stopped, or disconnected).
        if (prevStage === 'done') {
            toast.success('BLE remote learned successfully');
            void loadControls();
        } else if (prevStage === 'error') {
            toast.error('Learning failed');
        }
    }
}

function handleControlsUpdated(ev: {shellyID: string}) {
    if (ev.shellyID !== props.shellyID) return;
    void loadControls();
}

async function deleteControl(id: number) {
    if (!confirm('Remove this BLE control binding?')) return;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Control.Delete', {
            shellyID: props.shellyID,
            id
        });
        toast.info('Control binding removed');
        await loadControls();
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to remove control'));
    }
}

async function setDeviceKey(dev: PairedDevice) {
    const input = prompt('Enter AES-128 encryption key (32 hex characters), or leave blank to clear:', '');
    if (input === null) return;
    const key = input.trim();
    if (key && !/^[0-9a-fA-F]{32}$/.test(key)) {
        toast.error('Key must be exactly 32 hexadecimal characters');
        return;
    }
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Device.SetKey', {
            shellyID: props.shellyID,
            id: dev.id,
            key: key || null
        });
        toast.success('Encryption key updated');
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to set key'));
    }
}

function getBTHomeDeviceName(bthomedeviceKey: string): string {
    const id = Number.parseInt(bthomedeviceKey.split(':')[1] ?? '', 10);
    if (Number.isNaN(id)) return bthomedeviceKey;
    const dev = pairedDevices.value.find((d) => d.id === id);
    if (dev) return dev.name || dev.productName || dev.addr || bthomedeviceKey;
    // Fallback to entity store (populated before pairedDevices on cold load)
    const entity = Object.values(entityStore.entities).find(
        (e) =>
            e.type === 'bthomedevice' &&
            e.source === props.shellyID &&
            e.properties.id === id
    );
    if (!entity) return bthomedeviceKey;
    const p = entity.properties as any;
    return entity.name || p.productName || p.addr || bthomedeviceKey;
}

function formatControlEvent(inp: BTHomeControlInput): string {
    return inp.event.replace(/_/g, ' ');
}

let scanTimer: ReturnType<typeof setTimeout> | undefined;
let cleanupDiscovery: (() => void) | null = null;
let cleanupDone: (() => void) | null = null;

function startDiscoveryListeners() {
    const pairedMacs = new Set(
        pairedDevices.value.map((d) => d.addr.toUpperCase())
    );

    cleanupDiscovery = onBTHomeDiscovery((ev) => {
        if (ev.shellyID !== props.shellyID) return;
        const mac = ev.mac?.toUpperCase();
        if (!mac) return;
        if (pairedMacs.has(mac)) return;
        const existingIndex = discoveredDevices.value.findIndex(
            (d) => d.mac.toUpperCase() === mac
        );
        if (existingIndex !== -1) {
            discoveredDevices.value[existingIndex] = {
                ...discoveredDevices.value[existingIndex],
                ...ev
            };
            return;
        }
        discoveredDevices.value.push(ev);
    });
    cleanupDone = onBTHomeDone((ev) => {
        if (ev.shellyID !== props.shellyID) return;
        scanning.value = false;
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = undefined;
        }
        stopDiscoveryListeners();
        toast.success(
            `Scan complete — found ${ev.discoveredDevicesCount} device(s)`
        );
    });
}

function stopDiscoveryListeners() {
    cleanupDiscovery?.();
    cleanupDone?.();
    cleanupDiscovery = null;
    cleanupDone = null;
}

async function startScan() {
    scanning.value = true;
    discoveredDevices.value = [];
    if (scanTimer) clearTimeout(scanTimer);
    startDiscoveryListeners();
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.StartDiscovery', {
            shellyID: props.shellyID,
            duration: 10
        });
        toast.info('Scanning for BLE devices (10s)...');
        scanTimer = setTimeout(() => {
            scanning.value = false;
            stopDiscoveryListeners();
            scanTimer = undefined;
            if (discoveredDevices.value.length === 0) {
                toast.info('Scan complete — no devices found');
            }
        }, 12000);
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Scan failed'));
        scanning.value = false;
        stopDiscoveryListeners();
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = undefined;
        }
    }
}

async function pairDiscovered(mac: string) {
    pairingMac.value = mac;
    const discovered = discoveredDevices.value.find((d) => d.mac === mac);
    try {
        const result = await ws.sendRPC(
            'FLEET_MANAGER',
            'BTHome.Device.AddManual',
            {
                shellyID: props.shellyID,
                mac,
                productName:
                    discovered?.productName ?? discovered?.name ?? undefined,
                modelId: discovered?.modelString ?? undefined
            }
        );
        discoveredDevices.value = discoveredDevices.value.filter(
            (d) => d.mac !== mac
        );
        if (result?.alreadyPaired) {
            toast.info(`${discovered?.name || mac} was already paired`);
            if (!deviceStore.devices[props.shellyID]?.settings) {
                await waitForSettingsUpdate(1500);
            }
            await loadPairedDevices();
        } else {
            toast.success(`Device ${discovered?.name || mac} paired`);
            // Wait for the event chain: device → FM backend → WS → device store
            await waitForSettingsUpdate();
            await loadPairedDevices();
        }
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, 'Failed to pair device'));
    } finally {
        pairingMac.value = null;
    }
}

function resetState() {
    expandedDevice.value = null;
    knownObjects.value = [];
    discoveredDevices.value = [];
    scanning.value = false;
    objNameCache.clear(); // clear stale names when switching devices
    expandRequestId++; // cancel in-flight refreshExpandedObjects
    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = undefined;
    }
    stopDiscoveryListeners();
    if (learning.value) {
        ws.sendRPC('FLEET_MANAGER', 'BTHome.Control.StopLearning', {
            shellyID: props.shellyID
        }).catch(() => {});
    }
    learningState.value = null;
    controlBindings.value = [];
    if (settingsWaitTimer) {
        clearTimeout(settingsWaitTimer);
        settingsWaitTimer = undefined;
    }
}

async function syncLearningStateFromBackend() {
    try {
        const resp = await ws.sendRPC('FLEET_MANAGER', 'BTHome.Control.GetLearningState', {
            shellyID: props.shellyID
        });
        learningState.value = resp?.state ?? null;
    } catch {
        learningState.value = null;
    }
}

function subscribeLearningEvents() {
    unsubscribeLearning?.();
    unsubscribeControlsUpdated?.();
    unsubscribeLearning = onBTHomeControlLearning(handleLearningEvent);
    unsubscribeControlsUpdated = onBTHomeControlsUpdated(handleControlsUpdated);
}

function unsubscribeLearningEvents() {
    unsubscribeLearning?.();
    unsubscribeControlsUpdated?.();
    unsubscribeLearning = null;
    unsubscribeControlsUpdated = null;
}

onUnmounted(() => {
    unsubscribeLearningEvents();
    resetState();
});

onMounted(() => {
    subscribeLearningEvents();
    loadPairedDevices();
    loadDeviceInputs();
    loadControls();
    syncLearningStateFromBackend();
});
watch(
    () => props.shellyID,
    () => {
        resetState();
        loadPairedDevices();
        loadDeviceInputs();
        loadControls();
        syncLearningStateFromBackend();
    }
);

// Auto-refresh expanded device's objects when the gateway receives a BLE broadcast.
// The device status updates (rssi, battery, last_updated_ts) when a broadcast arrives —
// if the expanded device had 0 known objects, this means the objects are now available.
watch(
    () => {
        if (expandedDevice.value == null) return null;
        const key = `bthomedevice:${expandedDevice.value}`;
        return deviceStore.devices[props.shellyID]?.status?.[key]
            ?.last_updated_ts;
    },
    (newTs, oldTs) => {
        if (newTs && newTs !== oldTs && expandedDevice.value != null) {
            // New broadcast received — refresh objects (only if we had 0 before, to avoid flicker)
            if (knownObjects.value.length === 0) {
                refreshExpandedObjects(expandedDevice.value);
            }
        }
    }
);
</script>

<style scoped>
.bth {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* Section cards — same rounded-card language as the other settings pages. */
.bth__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4) var(--space-3);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
}

.bth__section-header {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.bth__list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
}

.bth__device {
    border-bottom: 0.5px solid var(--color-border-default);
}

.bth__device:last-child {
    border-bottom: none;
}

.bth__device-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    transition: background var(--duration-fast);
}

.bth__device-row:hover {
    background: rgba(249, 250, 250, 0.04);
}

.bth__bt-icon {
    color: var(--color-primary);
    font-size: var(--type-body);
    flex-shrink: 0;
}

.bth__device-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.bth__device-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.bth__device-addr {
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.6;
    font-family: var(--font-mono, monospace);
}

.bth__device-badge {
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.6;
    flex-shrink: 0;
    white-space: nowrap;
}

.bth__device-sensors {
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.6;
    flex-shrink: 0;
}

.bth__chevron {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    opacity: 0.4;
    flex-shrink: 0;
}

/* ── Objects ── */
.bth__objects {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) var(--space-3);
    background: rgba(var(--color-frost-rgb), 0.03);
}

.bth__obj-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) 0;
}

.bth__obj-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.bth__obj-assigned {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-status-on);
}

.bth__obj-remove {
    background: none;
    border: none;
    color: var(--color-status-red);
    cursor: pointer;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
    opacity: 0.6;
    transition: opacity var(--duration-fast);
}

.bth__obj-remove:hover {
    opacity: 1;
}
.bth__obj-device-event {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    font-style: italic;
}

.bth__device-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
}

/* ── Add / Scan ── */
.bth__add-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.bth__input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color var(--duration-fast);
}

.bth__input--select {
    flex: 0 1 auto;
    min-width: 140px;
    font-family: inherit;
}

.bth__input:focus {
    border-color: var(--color-primary);
}

.bth__input::placeholder {
    color: var(--color-frost);
    opacity: 0.4;
    font-family: inherit;
}

.bth__scan-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.bth__discovered {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.bth__bt-icon--discovered {
    color: var(--color-status-on);
}

/* ── BLE Control bindings ── */
.bth__control-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
}

/* ── Encryption ── */
.bth__badge--error {
    color: var(--color-status-red);
    opacity: 1;
}

.bth__encrypt-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: rgba(var(--color-status-off-rgb), 0.06);
    border-radius: var(--radius-sm);
}

.bth__encrypt-error {
    font-size: var(--type-body);
    color: var(--color-status-red);
    flex: 1;
    min-width: 0;
}

/* ── Misc ── */
.bth__loading {
    display: flex;
    justify-content: center;
    padding: var(--space-2) 0;
}

.bth__empty {
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.5;
    padding: var(--space-1) 0;
}
</style>
