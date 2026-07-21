<template>
    <div class="ble-board">
        <!-- Header -->
        <div class="ble-board__header">
            <button class="ble-board__back" @click="goBack">
                <i class="fas fa-arrow-left" />
            </button>
            <figure class="ble-board__icon-wrap">
                <i class="fab fa-bluetooth-b ble-board__bt-icon" />
            </figure>
            <div class="ble-board__meta">
                <span class="ble-board__product">{{ headerTitle }}</span>
                <span
                    v-if="productName && productName !== headerTitle"
                    class="ble-board__subtitle"
                >
                    {{ productName }}
                </span>
                <span v-if="modelId" class="ble-board__model">{{ modelId }}</span>
                <span class="ble-board__addr">{{ addr }}</span>
            </div>
        </div>

        <div class="ble-board__source-section">
            <div class="ble-board__info-header">
                <i class="fas fa-circle-nodes" /> Source Device
            </div>
            <div class="ble-board__detail-row">
                <span class="ble-board__detail-label">Gateway</span>
                <span class="ble-board__detail-value">{{ shellyID }}</span>
            </div>
            <div class="ble-board__detail-row">
                <span class="ble-board__detail-label">Display Name</span>
                <span class="ble-board__detail-value">{{ headerTitle }}</span>
            </div>
            <div v-if="productName" class="ble-board__detail-row">
                <span class="ble-board__detail-label">Product</span>
                <span class="ble-board__detail-value">{{ productName }}</span>
            </div>
            <div v-if="modelId" class="ble-board__detail-row">
                <span class="ble-board__detail-label">Model</span>
                <span class="ble-board__detail-value">{{ modelId }}</span>
            </div>
            <div class="ble-board__detail-row">
                <span class="ble-board__detail-label">Address</span>
                <span class="ble-board__detail-value">{{ addr }}</span>
            </div>
            <div v-if="deviceLastEvent" class="ble-board__detail-row">
                <span class="ble-board__detail-label">{{ deviceLastEventLabel }}</span>
                <span class="ble-board__detail-value ble-board__detail-value--accent">
                    {{ deviceLastEvent }}
                </span>
            </div>
            <div v-if="deviceActiveChannel" class="ble-board__detail-row">
                <span class="ble-board__detail-label">Active Channel</span>
                <span class="ble-board__detail-value">{{ deviceActiveChannel }}</span>
            </div>
            <div class="ble-board__detail-row">
                <span class="ble-board__detail-label">Paired</span>
                <span class="ble-board__detail-value">{{ devicePaired ? 'Yes' : 'No' }}</span>
            </div>
        </div>

        <div v-if="controlButtons.length" class="ble-board__source-section">
            <div class="ble-board__info-header">
                <i class="fas fa-table-cells-large" /> Controls
            </div>
            <div class="ble-board__controls-grid">
                <div
                    v-for="button in controlButtons"
                    :key="`${button.objId}-${button.idx}`"
                    class="ble-board__control-card"
                    :class="button.active ? 'ble-board__control-card--active' : ''"
                >
                    <span class="ble-board__control-label">{{ button.label }}</span>
                    <span class="ble-board__control-value">
                        {{ button.active ? button.status : 'Ready' }}
                    </span>
                </div>
            </div>
        </div>

        <!-- Sensor sections -->
        <div class="ble-board__sections">
            <div v-for="sensor in sensors" :key="sensor.id" class="ble-board__section">
                <div class="ble-board__section-header" @click="toggleSection(sensor.id)">
                    <i :class="sensorIcon(sensor)" class="ble-board__section-icon" />
                    <span class="ble-board__section-name">{{ sensorLabel(sensor) }}</span>
                    <span class="ble-board__section-value">{{ sensorDisplay(sensor) }}</span>
                    <i class="fas ble-board__chevron" :class="openSections.has(sensor.id) ? 'fa-chevron-up' : 'fa-chevron-down'" />
                </div>
                <div v-if="openSections.has(sensor.id)" class="ble-board__section-body">
                    <div class="ble-board__detail-row">
                        <span class="ble-board__detail-label">Value</span>
                        <span class="ble-board__detail-value">{{ sensorDisplay(sensor) }}</span>
                    </div>
                    <div class="ble-board__detail-row">
                        <span class="ble-board__detail-label">Last Updated</span>
                        <span class="ble-board__detail-value">{{ sensorLastUpdated(sensor) }}</span>
                    </div>
                    <div class="ble-board__detail-row">
                        <span class="ble-board__detail-label">Type</span>
                        <span class="ble-board__detail-value">{{ sensor.properties?.sensorType || '—' }}</span>
                    </div>
                    <div class="ble-board__detail-row">
                        <span class="ble-board__detail-label">Object ID</span>
                        <span class="ble-board__detail-value">{{ sensorConfig(sensor)?.obj_id ?? '—' }}</span>
                    </div>
                    <div v-if="sensorConfig(sensor)?.name" class="ble-board__detail-row">
                        <span class="ble-board__detail-label">Custom Name</span>
                        <span class="ble-board__detail-value">{{ sensorConfig(sensor).name }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Device info -->
        <div class="ble-board__info-section">
            <div class="ble-board__info-header"><i class="fas fa-info-circle" /> Device Info</div>
            <div class="ble-board__detail-row">
                <span class="ble-board__detail-label">Sensors</span>
                <span class="ble-board__detail-value">{{ sensors.length }}</span>
            </div>
            <div class="ble-board__detail-row">
                <span class="ble-board__detail-label">Parent Entity</span>
                <span class="ble-board__detail-value">{{ deviceEntity?.id ?? '—' }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {getBThomeBinaryStateWords} from '@/config/bthome-presentation';
import {
    formatBTHomeChannelLabel,
    formatBTHomeEventName,
    getBTHomeEventSourceLabel,
    isBTHomeControlSensor
} from '@/helpers/bthome-controls';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useRightSideMenuStore} from '@/stores/right-side';
import type {bthomedevice_entity, entity_t} from '@/types';

const SENSOR_ICONS: Record<string, string> = {
    temperature: 'fas fa-temperature-half',
    humidity: 'fas fa-droplet',
    battery: 'fas fa-battery-full',
    button: 'fas fa-circle-dot',
    dimmer: 'fas fa-sliders',
    illuminance: 'fas fa-sun',
    motion: 'fas fa-person-walking',
    door: 'fas fa-door-open',
    window: 'fas fa-window-maximize',
    count: 'fas fa-hashtag'
};

const props = defineProps<{
    shellyID: string;
    addr: string;
    displayName: string;
    productName: string;
    modelId: string;
    sensorIds: string[];
    deviceEntity?: entity_t | null;
}>();

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const rightSideStore = useRightSideMenuStore();

const device = computed(() => deviceStore.devices[props.shellyID]);
const deviceEntity = computed<bthomedevice_entity | null>(() =>
    props.deviceEntity?.type === 'bthomedevice'
        ? (props.deviceEntity as bthomedevice_entity)
        : null
);
const headerTitle = computed(
    () => props.displayName || props.productName || 'BLE Device'
);
const deviceStatus = computed(() => {
    const entity = deviceEntity.value;
    if (!entity) return null;
    return (
        device.value?.status?.[`bthomedevice:${entity.properties.id}`] ?? null
    );
});
const deviceOverview = computed(
    () =>
        (deviceStatus.value?.overview ?? null) as {
            activeChannelLabel?: string;
            lastEventLabel?: string;
        } | null
);
const devicePaired = computed(() => !!deviceStatus.value?.paired);
const deviceLastEvent = computed(() => {
    const evt = deviceStatus.value?.last_event;
    if (typeof evt === 'string' && evt.trim()) {
        return formatBTHomeEventName(evt);
    }
    if (evt != null) {
        return String(evt);
    }
    return null;
});
const deviceLastEventLabel = computed(() => {
    if (
        typeof deviceOverview.value?.lastEventLabel === 'string' &&
        deviceOverview.value.lastEventLabel.trim()
    ) {
        return deviceOverview.value.lastEventLabel;
    }

    const idx = deviceStatus.value?.last_event_idx;
    return getBTHomeEventSourceLabel({
        event:
            typeof deviceStatus.value?.last_event === 'string'
                ? deviceStatus.value.last_event
                : null,
        idx: typeof idx === 'number' && idx >= 0 ? idx : null,
        controls: deviceControls.value
    });
});
const deviceActiveChannel = computed(() => {
    if (
        typeof deviceOverview.value?.activeChannelLabel === 'string' &&
        deviceOverview.value.activeChannelLabel.trim()
    ) {
        return deviceOverview.value.activeChannelLabel;
    }

    return typeof deviceStatus.value?.channel === 'number'
        ? formatBTHomeChannelLabel(deviceStatus.value.channel)
        : null;
});
const deviceControls = computed(() =>
    Array.isArray(deviceEntity.value?.properties?.controls)
        ? deviceEntity.value.properties.controls
        : []
);

// Active button state comes from backend overview.controls[] — the backend
// tracks the 4s active window via #bthomeRuntimeEvent and ships {active, status}
// per control. Frontend just renders. No local timer, no duplicated protocol
// mapping (rotate_* → dimmer), no divergence risk.
const controlButtons = computed(() => {
    const overview = deviceOverview.value as {
        controls?: Array<{
            objId: number;
            idx: number;
            kind: 'button' | 'dimmer';
            label: string;
            active: boolean;
            status: string;
        }>;
    } | null;
    if (Array.isArray(overview?.controls) && overview.controls.length) {
        return overview.controls;
    }
    return deviceControls.value.map((c) => ({
        ...c,
        active: false,
        status: 'Ready'
    }));
});

const sensors = computed(() => {
    const result: entity_t[] = [];
    for (const id of props.sensorIds) {
        const e = entityStore.entities[id];
        if (e && !isBTHomeControlSensor(e.properties?.objName)) {
            result.push(e);
        }
    }
    return result;
});

// All sections open by default
const openSections = ref(new Set<string>(props.sensorIds));

function toggleSection(id: string) {
    if (openSections.value.has(id)) {
        openSections.value.delete(id);
    } else {
        openSections.value.add(id);
    }
}

async function goBack() {
    const {default: DeviceBoard} = await import('./DeviceBoard.vue');
    rightSideStore.showInspector(DeviceBoard, {
        shellyID: props.shellyID
    });
}

function sensorConfig(entity: entity_t): any {
    return (
        device.value?.settings?.[`bthomesensor:${entity.properties.id}`] ?? null
    );
}

function sensorStatus(entity: entity_t): any {
    return (
        device.value?.status?.[`bthomesensor:${entity.properties.id}`] ?? null
    );
}

function sensorIcon(entity: entity_t): string {
    const objName = entity.properties?.objName ?? '';
    return SENSOR_ICONS[objName] ?? 'fas fa-wave-square';
}

function sensorLabel(entity: entity_t): string {
    const configName = sensorConfig(entity)?.name;
    if (typeof configName === 'string' && configName.trim()) {
        return configName.trim();
    }
    const objName = entity.properties?.objName ?? '';
    return formatBTHomeEventName(objName) || entity.name || 'Sensor';
}

function sensorDisplay(entity: entity_t): string {
    const status = sensorStatus(entity);
    const objName = entity.properties?.objName ?? '';
    const unit = entity.properties?.unit ?? '';

    if (!status || status.value == null) {
        return objName === 'button' || objName === 'dimmer' ? 'No events' : '—';
    }

    const val = status.last_event ?? status.value;
    if (objName === 'button' || objName === 'dimmer') {
        if (typeof val === 'string') return formatBTHomeEventName(val);
        if (typeof val === 'number') return `Event ${val}`;
        return String(val);
    }
    if (typeof val === 'number') {
        if (objName === 'channel') return formatBTHomeChannelLabel(val);
        return unit
            ? `${Number.isInteger(val) ? val : val.toFixed(1)} ${unit}`
            : String(val);
    }
    if (typeof val === 'boolean') return formatBTHomeBinaryValue(objName, val);
    return String(val);
}

// Binary state words are presentation, keyed on the backend-sent objName.
function formatBTHomeBinaryValue(objName: string, value: boolean): string {
    const words = getBThomeBinaryStateWords(objName);
    return value ? words.on : words.off;
}

function sensorLastUpdated(entity: entity_t): string {
    const status = sensorStatus(entity);
    const ts = status?.last_updated_ts;
    if (!ts) return 'Never';
    const date = new Date(ts * 1000);
    const now = Date.now();
    const diffS = Math.floor((now - date.getTime()) / 1000);
    if (diffS < 0) return 'Just now';
    if (diffS < 60) return 'Just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)} min ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
</script>

<style scoped>
.ble-board {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
}
.ble-board__header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.ble-board__icon-wrap {
    width: 48px; height: 48px;
    border-radius: var(--radius-full);
    display: flex; align-items: center; justify-content: center;
    background: rgba(37, 99, 235, 0.1);
    border: 2px solid rgba(37, 99, 235, 0.3);
}
.ble-board__bt-icon { font-size: var(--type-subheading); color: var(--color-ble); }
.ble-board__meta { flex: 1; display: flex; flex-direction: column; }
.ble-board__product { font-size: var(--type-body); font-weight: var(--font-semibold); color: var(--color-text-primary); }
.ble-board__subtitle { font-size: var(--type-body); color: var(--color-text-tertiary); }
.ble-board__model { font-size: var(--type-body); color: var(--color-text-disabled); }
.ble-board__addr { font-size: var(--type-body); color: var(--color-text-quaternary); font-family: monospace; }
.ble-board__back {
    background: none; border: none; color: var(--color-text-tertiary);
    font-size: var(--type-body); cursor: pointer; display: flex; align-items: center; gap: var(--space-1);
}
.ble-board__back:hover { color: var(--color-text-primary); }
.ble-board__source-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
}
.ble-board__controls-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-2);
}
.ble-board__control-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
}
.ble-board__control-card--active {
    border-color: rgba(var(--color-warning-rgb), 0.45);
    background: rgba(var(--color-warning-rgb), 0.12);
}
.ble-board__control-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ble-board__control-value {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

/* Sections */
.ble-board__sections { display: flex; flex-direction: column; gap: var(--space-0-5); }
.ble-board__section {
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    overflow: hidden;
}
.ble-board__section-header {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    cursor: pointer; user-select: none;
}
.ble-board__section-header:hover { background: var(--color-surface-1); }
.ble-board__section-icon { font-size: var(--type-body); color: var(--color-text-tertiary); width: 20px; text-align: center; }
.ble-board__section-name { font-size: var(--type-body); font-weight: var(--font-medium); color: var(--color-text-secondary); flex: 1; }
.ble-board__section-value { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.ble-board__chevron { font-size: var(--type-body); color: var(--color-text-disabled); }

.ble-board__section-body {
    padding: 0 var(--space-4) var(--space-3);
    display: flex; flex-direction: column; gap: var(--space-1);
    border-top: 1px solid var(--color-border-default);
}

/* Detail rows */
.ble-board__detail-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: var(--space-0-5) 0;
}
.ble-board__detail-label { font-size: var(--type-body); color: var(--color-text-disabled); }
.ble-board__detail-value { font-size: var(--type-body); font-weight: var(--font-medium); color: var(--color-text-secondary); }
.ble-board__detail-value--accent { color: var(--color-warning-text); }

/* Info section */
.ble-board__info-section {
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border-default);
    padding-top: var(--space-3);
    display: flex; flex-direction: column; gap: var(--space-1);
}
.ble-board__info-header {
    font-size: var(--type-body); font-weight: var(--font-semibold);
    color: var(--color-text-secondary); display: flex; align-items: center; gap: var(--space-2);
    margin-bottom: var(--space-1);
}
</style>
