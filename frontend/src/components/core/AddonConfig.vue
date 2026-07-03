<template>
    <div class="addon-config">
        <!-- Addon mode selector -->
        <div class="addon-config__section">
            <div class="addon-config__label">Addon Type</div>
            <Dropdown
                :default="addonTypeToLabel(localAddonType)"
                :options="addonTypeOptions"
                @selected="(val) => localAddonType = addonLabelToType(val)"
            />
            <div v-if="localAddonType !== currentAddonType" class="addon-config__actions">
                <p class="addon-config__warn">
                    <i class="fas fa-triangle-exclamation" />
                    Changing type requires a device reboot.
                </p>
                <Button type="blue" size="sm" :loading="applyingType" @click="applyAddonType">
                    Apply &amp; Reboot
                </Button>
            </div>
        </div>

        <!-- Peripherals (only when addon_type = "sensor") -->
        <template v-if="currentAddonType === 'sensor'">
            <!-- Registered peripherals -->
            <div class="addon-config__section">
                <div class="addon-config__label">Registered Peripherals</div>

                <div v-if="loading" class="addon-config__loading">
                    <Spinner size="sm" />
                </div>

                <div v-else-if="peripheralList.length > 0" class="addon-config__list">
                    <div
                        v-for="p in peripheralList"
                        :key="p.component"
                        class="addon-config__peripheral"
                    >
                        <div class="addon-config__row" @click="togglePeripheralExpand(p.component)">
                            <i :class="peripheralIcon(p.type)" class="addon-config__row-icon" />
                            <div class="addon-config__row-info">
                                <span class="addon-config__row-name">{{ p.name || p.component }}</span>
                                <span class="addon-config__row-detail">{{ peripheralLabel(p.type) }}<template v-if="p.addr"> · {{ p.addr }}</template></span>
                            </div>
                            <i class="fas addon-config__row-chevron" :class="expandedPeripheral === p.component ? 'fa-chevron-up' : 'fa-chevron-down'" />
                        </div>

                        <!-- Expanded settings -->
                        <div v-if="expandedPeripheral === p.component" class="addon-config__settings">
                            <div class="addon-config__setting">
                                <span class="addon-config__setting-label">Name</span>
                                <input
                                    :value="p.name ?? ''"
                                    class="addon-config__setting-input"
                                    placeholder="(default)"
                                    @change="(e) => savePeripheralConfig(p, 'name', (e.target as HTMLInputElement).value || null)"
                                />
                            </div>
                            <div v-if="p.type === 'ds18b20' || p.type === 'dht22'" class="addon-config__setting">
                                <span class="addon-config__setting-label">Temperature Offset (°C)</span>
                                <input
                                    :value="p.offset_C ?? 0"
                                    type="number"
                                    step="0.1"
                                    class="addon-config__setting-input"
                                    @change="(e) => savePeripheralConfig(p, 'offset_C', Number((e.target as HTMLInputElement).value))"
                                />
                            </div>
                            <div v-if="p.type === 'ds18b20' || p.type === 'dht22'" class="addon-config__setting">
                                <span class="addon-config__setting-label">Report Threshold (°C)</span>
                                <input
                                    :value="p.report_thr_C ?? 0.1"
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    class="addon-config__setting-input"
                                    @change="(e) => savePeripheralConfig(p, 'report_thr_C', Number((e.target as HTMLInputElement).value))"
                                />
                            </div>
                            <div class="addon-config__setting-actions">
                                <Button type="red" size="sm" @click="removePeripheral(p)">
                                    Remove
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
                <p v-else class="addon-config__hint">No peripherals registered.</p>

                <div v-if="needsReboot" class="addon-config__reboot-banner">
                    <span><i class="fas fa-rotate" /> Changes require reboot to take effect.</span>
                    <Button type="blue" size="sm" :loading="rebooting" @click="rebootDevice">Reboot Now</Button>
                </div>
            </div>

            <!-- Discover / Add -->
            <div class="addon-config__section">
                <div class="addon-config__label">Add Peripheral</div>

                <Dropdown
                    :default="addType ? peripheralLabel(addType) : 'Select type…'"
                    :options="addTypeOptions"
                    @selected="(val) => onAddTypeSelected(addLabelToType(val))"
                />

                <!-- DS18B20: auto-scan results -->
                <template v-if="addType === 'ds18b20'">
                    <div v-if="scanning" class="addon-config__loading">
                        <Spinner size="sm" />
                        <span class="addon-config__hint">Scanning 1-Wire bus…</span>
                    </div>
                    <p v-else-if="scanError" class="addon-config__error">
                        {{ scanError }}
                        <button type="button" class="addon-config__link" @click="scanOneWire">Retry</button>
                    </p>
                    <template v-else-if="scanResults.length > 0">
                        <div class="addon-config__list">
                            <div
                                v-for="dev in scanResults"
                                :key="dev.addr"
                                class="addon-config__row"
                            >
                                <i class="fas fa-temperature-half addon-config__row-icon" />
                                <div class="addon-config__row-info">
                                    <span class="addon-config__row-name">{{ dev.type }}</span>
                                    <span class="addon-config__row-detail">{{ dev.addr }}</span>
                                </div>
                                <span v-if="dev.component" class="addon-config__row-assigned">
                                    {{ dev.component }}
                                </span>
                                <div v-else class="addon-config__row-actions">
                                    <Button type="green" size="sm" :loading="adding" @click="addDs18b20(dev.addr, false)">Add</Button>
                                    <Button type="green" size="sm" :loading="adding" @click="addDs18b20(dev.addr, true)">Add &amp; Reboot</Button>
                                </div>
                            </div>
                        </div>
                        <Button type="blue-hollow" size="sm" :loading="scanning" @click="scanOneWire">
                            Rescan
                        </Button>
                    </template>
                    <p v-else-if="scanned" class="addon-config__hint">No sensors found on bus.</p>
                </template>

                <!-- Non-DS18B20: direct add buttons -->
                <template v-else-if="addType">
                    <div class="addon-config__add-actions">
                        <Button type="green" size="sm" :loading="adding" @click="addPeripheral(addType, false)">
                            Add
                        </Button>
                        <Button type="green" size="sm" :loading="adding" @click="addPeripheral(addType, true)">
                            Add &amp; Reboot
                        </Button>
                    </div>
                </template>
            </div>
        </template>

        <!-- Pro Output addon (Pro3EM) -->
        <template v-else-if="currentAddonType === 'prooutput'">
            <div class="addon-config__section">
                <div class="addon-config__label">Peripherals</div>

                <div v-if="proOutputLoading" class="addon-config__loading">
                    <Spinner size="sm" />
                </div>

                <div v-else-if="proOutputPeripherals.length > 0" class="addon-config__list">
                    <div v-for="p in proOutputPeripherals" :key="p.component" class="addon-config__row">
                        <i class="fas fa-toggle-on addon-config__row-icon" />
                        <div class="addon-config__row-info">
                            <span class="addon-config__row-name">{{ p.component }}</span>
                            <span class="addon-config__row-detail">{{ p.type }}</span>
                        </div>
                        <Button type="red" size="sm" @click="removeProOutputPeripheral(p.component)">
                            Remove
                        </Button>
                    </div>
                </div>
                <p v-else class="addon-config__hint">No peripherals registered.</p>

                <div v-if="proOutputNeedsReboot" class="addon-config__reboot-banner">
                    <span><i class="fas fa-rotate" /> Changes require reboot to take effect.</span>
                    <Button type="blue" size="sm" :loading="rebooting" @click="rebootDevice">Reboot Now</Button>
                </div>
            </div>

            <div class="addon-config__section">
                <div class="addon-config__label">Add Peripheral</div>
                <div class="addon-config__add-actions">
                    <Button type="green" size="sm" :loading="proOutputAdding" @click="addProOutputPeripheral">
                        Add Switch
                    </Button>
                </div>
            </div>
        </template>

        <!-- LoRa addon -->
        <template v-else-if="currentAddonType === 'LoRa'">
            <div class="addon-config__section">
                <div class="addon-config__label">LoRa Add-on</div>
                <p class="addon-config__hint">
                    LoRa radio addon is active. Configuration is managed
                    via LoRa.GetConfig / LoRa.SetConfig RPCs.
                </p>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Dropdown from './Dropdown.vue';
import Spinner from './Spinner.vue';

const props = defineProps<{
    shellyID: string;
}>();

const deviceStore = useDevicesStore();
const toast = useToastStore();

// ── Addon type ──
const ALL_ADDON_TYPE_LABELS: Record<string, string> = {
    none: 'None',
    sensor: 'Sensor Add-on',
    prooutput: 'Pro Output Add-on',
    LoRa: 'LoRa Add-on'
};

const isProDevice = computed(() => {
    const app = (
        deviceStore.devices[props.shellyID]?.info?.app ?? ''
    ).toLowerCase();
    return app.startsWith('pro') || app.includes('pro');
});

const addonTypeOptions = computed(() => {
    // Plus/Gen3/Gen4: Sensor + LoRa
    // Pro: Sensor + ProOutput + LoRa
    const types = ['none', 'sensor', 'LoRa'];
    if (isProDevice.value) types.splice(2, 0, 'prooutput');
    return types.map((t) => ALL_ADDON_TYPE_LABELS[t] ?? t);
});

const localAddonType = ref('none');
const applyingType = ref(false);

function addonTypeToLabel(type: string): string {
    return ALL_ADDON_TYPE_LABELS[type] ?? type;
}

function addonLabelToType(label: string): string {
    for (const [type, l] of Object.entries(ALL_ADDON_TYPE_LABELS)) {
        if (l === label) return type;
    }
    return label;
}

const currentAddonType = computed(() => {
    const dev = deviceStore.devices[props.shellyID];
    return dev?.settings?.sys?.device?.addon_type ?? 'none';
});

// ── Peripherals ──
const loading = ref(false);
const needsReboot = ref(false);
const rebooting = ref(false);
const adding = ref(false);

type PeripheralEntry = {
    type: string;
    component: string;
    addr?: string;
    name?: string;
    offset_C?: number;
    report_thr_C?: number;
};

const expandedPeripheral = ref<string | null>(null);

function togglePeripheralExpand(component: string) {
    expandedPeripheral.value =
        expandedPeripheral.value === component ? null : component;
}

const peripheralList = ref<PeripheralEntry[]>([]);

// ── Add peripheral ──
const addType = ref('');
const ADD_TYPE_LABELS: Record<string, string> = {
    ds18b20: 'Temperature (DS18B20)',
    dht22: 'Temperature & Humidity (DHT22)',
    digital_in: 'Digital Input',
    analog_in: 'Analog Input',
    voltmeter: 'Voltmeter'
};
const addTypeOptions = Object.values(ADD_TYPE_LABELS);

function addLabelToType(label: string): string {
    for (const [type, l] of Object.entries(ADD_TYPE_LABELS)) {
        if (l === label) return type;
    }
    return label;
}

// ── 1-Wire scan ──
const scanning = ref(false);
const scanned = ref(false);
const scanError = ref('');

type ScanDevice = {
    type: string;
    addr: string;
    component: string | null;
};
const scanResults = ref<ScanDevice[]>([]);

// ── Helpers ──
function peripheralIcon(type: string): string {
    const icons: Record<string, string> = {
        ds18b20: 'fas fa-temperature-half',
        dht22: 'fas fa-droplet-degree',
        digital_in: 'fas fa-signal-stream',
        analog_in: 'fas fa-wave-sine',
        voltmeter: 'fas fa-bolt'
    };
    return icons[type] ?? 'fas fa-puzzle-piece';
}

function peripheralLabel(type: string): string {
    return ADD_TYPE_LABELS[type] ?? type;
}

// ── Load peripherals ──
async function loadPeripherals() {
    loading.value = true;
    try {
        const resp = await sendRPC<Record<string, any>>(
            'FLEET_MANAGER',
            'Addon.Sensor.GetPeripherals',
            {shellyID: props.shellyID}
        );

        const entries: PeripheralEntry[] = [];
        for (const [type, components] of Object.entries(resp ?? {})) {
            if (!components || typeof components !== 'object') continue;
            for (const [component, attrs] of Object.entries(
                components as Record<string, any>
            )) {
                entries.push({
                    type,
                    component,
                    addr: attrs?.addr,
                    name: undefined
                });
            }
        }

        // Fetch config for all peripherals in parallel
        await Promise.allSettled(
            entries.map(async (entry) => {
                const idNum = Number.parseInt(
                    entry.component.split(':')[1],
                    10
                );
                const compType = entry.component.split(':')[0];
                const cfg = await sendRPC<Record<string, any>>(
                    'FLEET_MANAGER',
                    'Addon.Peripheral.GetConfig',
                    {
                        shellyID: props.shellyID,
                        component: capitalize(compType),
                        id: idNum
                    }
                );
                if (cfg?.name) entry.name = cfg.name;
                if (cfg?.offset_C != null) entry.offset_C = cfg.offset_C;
                if (cfg?.report_thr_C != null)
                    entry.report_thr_C = cfg.report_thr_C;
            })
        );

        peripheralList.value = entries;
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to load peripherals');
    } finally {
        loading.value = false;
    }
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Apply addon type ──
async function applyAddonType() {
    const newType =
        localAddonType.value === 'none' ? null : localAddonType.value;
    applyingType.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Sys.SetConfig', {
            shellyID: props.shellyID,
            config: {device: {addon_type: newType}}
        });
        toast.info('Addon type changed — rebooting device…');
        await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {shellyID: props.shellyID});
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to change addon type');
    } finally {
        applyingType.value = false;
    }
}

// ── 1-Wire scan ──
async function scanOneWire() {
    scanning.value = true;
    scanError.value = '';
    scanned.value = false;
    try {
        const resp = await sendRPC<{devices?: ScanDevice[]}>(
            'FLEET_MANAGER',
            'Addon.Sensor.OneWireScan',
            {shellyID: props.shellyID}
        );
        scanResults.value = resp?.devices ?? [];
        scanned.value = true;
    } catch (err: any) {
        scanError.value = err?.message ?? 'Scan failed';
        scanResults.value = [];
    } finally {
        scanning.value = false;
    }
}

// ── Add peripheral ──
function onAddTypeSelected(val: string) {
    addType.value = val;
    scanResults.value = [];
    scanned.value = false;
    scanError.value = '';
    if (val === 'ds18b20') {
        scanOneWire();
    }
}

async function savePeripheralConfig(
    p: PeripheralEntry,
    field: string,
    value: any
) {
    const compType = p.component.split(':')[0];
    const idNum = Number.parseInt(p.component.split(':')[1], 10);
    try {
        await sendRPC('FLEET_MANAGER', 'Addon.Peripheral.SetConfig', {
            shellyID: props.shellyID,
            component: capitalize(compType),
            id: idNum,
            config: {[field]: value}
        });
        toast.success(`${field} updated`);
        await loadPeripherals();
    } catch (err: any) {
        toast.error(err?.message ?? `Failed to update ${field}`);
    }
}

async function addDs18b20(addr: string, andReboot: boolean) {
    adding.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Addon.Sensor.AddPeripheral', {
            shellyID: props.shellyID,
            type: 'ds18b20',
            attrs: {addr}
        });
        if (andReboot) {
            toast.success('DS18B20 added — rebooting…');
            await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {shellyID: props.shellyID});
        } else {
            needsReboot.value = true;
            toast.success('DS18B20 added — reboot to activate');
            await loadPeripherals();
            await scanOneWire();
        }
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to add sensor');
    } finally {
        adding.value = false;
    }
}

async function addPeripheral(type: string, andReboot: boolean) {
    adding.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Addon.Sensor.AddPeripheral', {
            shellyID: props.shellyID,
            type
        });
        if (andReboot) {
            toast.success(`${peripheralLabel(type)} added — rebooting…`);
            await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {shellyID: props.shellyID});
        } else {
            needsReboot.value = true;
            toast.success(
                `${peripheralLabel(type)} added — reboot to activate`
            );
            await loadPeripherals();
        }
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to add peripheral');
    } finally {
        adding.value = false;
    }
}

// ── Remove peripheral ──
async function removePeripheral(p: PeripheralEntry) {
    if (!confirm(`Remove ${p.name || p.component}?`)) return;

    try {
        await sendRPC('FLEET_MANAGER', 'Addon.Sensor.RemovePeripheral', {
            shellyID: props.shellyID,
            component: p.component
        });
        needsReboot.value = true;
        toast.info(`${p.component} removed — reboot to apply`);
        await loadPeripherals();
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to remove peripheral');
    }
}

// ── Reboot ──
async function rebootDevice() {
    rebooting.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {shellyID: props.shellyID});
        toast.info('Device rebooting…');
        needsReboot.value = false;
    } catch (err: any) {
        toast.error(err?.message ?? 'Reboot failed');
    } finally {
        rebooting.value = false;
    }
}

// ── Pro Output addon ──
const proOutputLoading = ref(false);
const proOutputAdding = ref(false);
const proOutputNeedsReboot = ref(false);
type ProOutputEntry = {type: string; component: string};
const proOutputPeripherals = ref<ProOutputEntry[]>([]);

async function loadProOutputPeripherals() {
    proOutputLoading.value = true;
    try {
        const resp = await sendRPC<Record<string, any>>(
            'FLEET_MANAGER',
            'Addon.ProOutput.GetPeripherals',
            {shellyID: props.shellyID}
        );
        const entries: ProOutputEntry[] = [];
        for (const [type, components] of Object.entries(resp ?? {})) {
            if (!components || typeof components !== 'object') continue;
            for (const component of Object.keys(
                components as Record<string, any>
            )) {
                entries.push({type, component});
            }
        }
        proOutputPeripherals.value = entries;
    } catch {
        /* ignore */
    }
    proOutputLoading.value = false;
}

async function addProOutputPeripheral() {
    proOutputAdding.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Addon.ProOutput.AddPeripheral', {
            shellyID: props.shellyID,
            type: 'digital_out'
        });
        proOutputNeedsReboot.value = true;
        toast.success('Switch peripheral added — reboot to activate');
        await loadProOutputPeripherals();
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to add peripheral');
    }
    proOutputAdding.value = false;
}

async function removeProOutputPeripheral(component: string) {
    if (!confirm(`Remove ${component}?`)) return;
    try {
        await sendRPC(
            'FLEET_MANAGER',
            'Addon.ProOutput.RemovePeripheral',
            {shellyID: props.shellyID, component}
        );
        proOutputNeedsReboot.value = true;
        toast.info(`${component} removed — reboot to apply`);
        await loadProOutputPeripherals();
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to remove peripheral');
    }
}

// ── Init ──
onMounted(() => {
    localAddonType.value = currentAddonType.value || 'none';
    if (currentAddonType.value === 'sensor') loadPeripherals();
    if (currentAddonType.value === 'prooutput') loadProOutputPeripherals();
});

watch(
    () => props.shellyID,
    () => {
        localAddonType.value = currentAddonType.value || 'none';
        needsReboot.value = false;
        scanResults.value = [];
        scanned.value = false;
        if (currentAddonType.value === 'sensor') {
            loadPeripherals();
        } else if (currentAddonType.value === 'prooutput') {
            loadProOutputPeripherals();
        } else {
            peripheralList.value = [];
            proOutputPeripherals.value = [];
        }
    }
);
</script>

<style scoped>
.addon-config {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.addon-config__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.addon-config__label {
    font-size: var(--type-body);
    font-weight: var(--font-black);
    color: var(--color-text-disabled);
    text-transform: none;
    letter-spacing: normal;
}

.addon-config__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}

.addon-config__warn {
    font-size: var(--type-body);
    color: var(--color-status-warn);
}

.addon-config__warn i {
    margin-right: var(--space-1);
}

/* ── List rows ── */
.addon-config__list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
}

.addon-config__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 0.5px solid var(--color-border-default);
    transition: background var(--duration-fast);
}

.addon-config__row:last-child {
    border-bottom: none;
}

.addon-config__row:hover {
    background: rgba(249, 250, 250, 0.04);
}

.addon-config__row-icon {
    color: var(--color-frost);
    opacity: 0.6;
    font-size: var(--type-body);
    flex-shrink: 0;
    width: 18px;
    text-align: center;
}

.addon-config__row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.addon-config__row-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.addon-config__row-detail {
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.6;
}

.addon-config__row-assigned {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-status-on);
    flex-shrink: 0;
}

.addon-config__row-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-danger-text);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}

.addon-config__row-btn:hover {
    background: var(--color-surface-3);
    border-color: var(--color-border-medium);
}

.addon-config__row-btn--add {
    color: var(--color-primary);
    border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
}

.addon-config__row-btn--add:hover {
    background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-1));
}

.addon-config__link {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
    margin-left: var(--space-2);
}

/* ── Peripheral expand ── */
.addon-config__peripheral {
    border-bottom: 0.5px solid var(--color-border-default);
}

.addon-config__peripheral:last-child {
    border-bottom: none;
}

.addon-config__row-chevron {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    opacity: 0.4;
    flex-shrink: 0;
}

.addon-config__row-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
}

.addon-config__settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    background: rgba(var(--color-frost-rgb), 0.03);
}

.addon-config__setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.addon-config__setting-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
}

.addon-config__setting-input {
    width: 140px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
    outline: none;
    text-align: right;
    transition: border-color var(--duration-fast);
}

.addon-config__setting-input:focus {
    border-color: var(--color-primary);
}

.addon-config__setting-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-1);
}

.addon-config__add-actions {
    display: flex;
    gap: var(--space-2);
}

/* ── Reboot banner ── */
.addon-config__reboot-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(var(--color-primary-rgb), 0.08);
    border: 1px solid rgba(var(--color-primary-rgb), 0.2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-primary);
}

/* ── Misc ── */
.addon-config__hint {
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.5;
}

.addon-config__error {
    font-size: var(--type-body);
    color: var(--color-status-red);
}

.addon-config__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
}
</style>
