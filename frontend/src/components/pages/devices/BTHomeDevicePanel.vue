<template>
    <div class="bth-board">
        <!-- Back to gateway -->
        <div v-if="showGatewayButton" class="bth-board__header">
            <button type="button" class="bth-board__back" @click="emit('open-gateway')">
                <i class="fas fa-arrow-left" /> Gateway
            </button>
        </div>

        <div class="bth-board__frame">
            <!-- Title (matches board-tabs visual) -->
            <div class="bth-board__title">
                <span class="bth-board__eyebrow">{{ kindLabel }}</span>
                <h3 class="bth-board__name">{{ title }}</h3>
                <p v-if="productLine" class="bth-board__sub">{{ productLine }}</p>
            </div>

            <!-- Scrollable content panel -->
            <div class="bth-board__panel">

                <!-- Overview -->
                <section class="bth-board__section">
                    <h4 class="bth-board__section-title">
                        <i class="fab fa-bluetooth-b" /> Overview
                    </h4>
                    <div class="bth-board__meta">
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Gateway</span>
                            <span class="bth-board__meta-value">{{ props.shellyId }}</span>
                        </div>
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Address</span>
                            <span class="bth-board__meta-value bth-board__mono">{{ address }}</span>
                        </div>
                        <div v-if="productName" class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Product</span>
                            <span class="bth-board__meta-value">{{ productName }}</span>
                        </div>
                        <div v-if="modelId" class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Model</span>
                            <span class="bth-board__meta-value">{{ modelId }}</span>
                        </div>
                        <div v-if="localName && localName !== modelId" class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Local Name</span>
                            <span class="bth-board__meta-value">{{ localName }}</span>
                        </div>
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Paired</span>
                            <span class="bth-board__meta-value">{{ pairedText }}</span>
                        </div>
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Battery</span>
                            <span class="bth-board__meta-value">{{ batteryText }}</span>
                        </div>
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">RSSI</span>
                            <span class="bth-board__meta-value">{{ rssiText }}</span>
                        </div>
                        <div v-if="activeChannelText" class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Active Channel</span>
                            <span class="bth-board__meta-value">{{ activeChannelText }}</span>
                        </div>
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Last Event</span>
                            <span class="bth-board__meta-value">{{ lastEventText }}</span>
                        </div>
                        <div class="bth-board__meta-row">
                            <span class="bth-board__meta-label">Last Update</span>
                            <span class="bth-board__meta-value">{{ lastUpdatedText }}</span>
                        </div>
                    </div>
                </section>

                <!-- Controls -->
                <section v-if="controls.length" class="bth-board__section">
                    <h4 class="bth-board__section-title">
                        <i class="fas fa-table-cells-large" /> Controls
                    </h4>
                    <div class="bth-board__controls">
                        <div
                            v-for="control in controls"
                            :key="`${control.objId}-${control.idx}`"
                            class="bth-board__control"
                            :class="{ 'bth-board__control--active': control.active }"
                        >
                            <span class="bth-board__control-label">{{ control.label }}</span>
                            <span class="bth-board__control-value">{{ control.status }}</span>
                        </div>
                    </div>
                </section>

                <!-- Sensors -->
                <section class="bth-board__section">
                    <h4 class="bth-board__section-title">
                        <i class="fas fa-wave-square" /> Sensors
                    </h4>
                    <div v-if="sensors.length" class="bth-board__sensors">
                        <div
                            v-for="sensor in sensors"
                            :key="sensor.componentKey"
                            class="bth-board__sensor"
                        >
                            <div class="bth-board__sensor-main">
                                <span class="bth-board__sensor-label">{{ sensor.label }}</span>
                                <span class="bth-board__sensor-value">{{ sensor.displayValue }}</span>
                            </div>
                            <div class="bth-board__sensor-meta">
                                <span>{{ sensor.sensorType }}</span>
                                <span v-if="sensor.objName">{{ sensor.objName }}</span>
                                <span>updated {{ formatTimestamp(sensor.lastUpdatedTs) }}</span>
                            </div>
                        </div>
                    </div>
                    <p v-else class="bth-board__empty">No child sensors reported yet.</p>
                </section>

            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue';
import {firstString} from '@/helpers/firstString';

const TICK_INTERVAL_MS = 30_000;
const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    tickTimer = setInterval(() => {
        now.value = Date.now();
    }, TICK_INTERVAL_MS);
});

onUnmounted(() => {
    if (tickTimer != null) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
});

type BTHomeOverviewControl = {
    objId: number;
    idx: number;
    label: string;
    active: boolean;
    status: string;
};

type BTHomeOverviewSensor = {
    componentKey: string;
    id: number;
    objId: number;
    objName: string;
    label: string;
    sensorType: string;
    unit: string;
    displayValue: string;
    lastUpdatedTs: number | null;
};

type BTHomeOverview = {
    addr?: string;
    displayName?: string;
    productName?: string;
    modelId?: string;
    localName?: string;
    kind?: string;
    paired?: boolean;
    battery?: number | null;
    rssi?: number | null;
    activeChannel?: number | null;
    activeChannelLabel?: string;
    lastEvent?: string;
    lastEventSummary?: string;
    lastUpdatedTs?: number | null;
    controls?: BTHomeOverviewControl[];
    sensors?: BTHomeOverviewSensor[];
};

const props = withDefaults(
    defineProps<{
        shellyId: string;
        status?: Record<string, any> | null;
        settings?: Record<string, any> | null;
        entityProperties?: Record<string, any> | null;
        displayName?: string;
        addr?: string;
        showHeader?: boolean;
        showGatewayButton?: boolean;
    }>(),
    {
        status: null,
        settings: null,
        entityProperties: null,
        displayName: '',
        addr: '',
        showHeader: false,
        showGatewayButton: false
    }
);

const emit = defineEmits<(e: 'open-gateway') => void>();

const overview = computed(
    () => (props.status?.overview ?? null) as BTHomeOverview | null
);

// settings + entityProperties are typed `Record<string, any>` from the
// backend, so an unexpected non-string value (e.g. a localized name
// object) would otherwise interpolate as "[object Object]". firstString
// guarantees the header always renders a real string.
const address = computed(() =>
    firstString(
        overview.value?.addr,
        props.settings?.addr,
        props.entityProperties?.addr,
        props.addr
    ) ?? '—'
);
const title = computed(() =>
    firstString(
        overview.value?.displayName,
        props.settings?.name,
        props.displayName,
        props.entityProperties?.productName,
        address.value
    ) ?? 'BLE Device'
);
const productName = computed(() =>
    firstString(
        overview.value?.productName,
        props.settings?.productName,
        props.settings?.meta?.productName,
        props.entityProperties?.productName
    ) ?? ''
);
const modelId = computed(() =>
    firstString(
        overview.value?.modelId,
        props.settings?.modelId,
        props.settings?.meta?.modelId,
        props.entityProperties?.modelId
    ) ?? ''
);
const localName = computed(() =>
    firstString(
        overview.value?.localName,
        props.settings?.localName,
        props.settings?.meta?.localName,
        props.entityProperties?.localName
    ) ?? ''
);
const kindLabel = computed(() =>
    formatKind(firstString(overview.value?.kind) ?? undefined)
);
const pairedText = computed(() => {
    const paired =
        typeof overview.value?.paired === 'boolean'
            ? overview.value.paired
            : props.entityProperties?.paired === true;
    return paired ? 'Yes' : 'No';
});
const batteryText = computed(() => {
    const battery =
        typeof overview.value?.battery === 'number'
            ? overview.value.battery
            : typeof props.status?.battery === 'number'
              ? props.status.battery
              : null;
    return typeof battery === 'number' ? `${battery}%` : '—';
});
const rssiText = computed(() => {
    const rssi =
        typeof overview.value?.rssi === 'number'
            ? overview.value.rssi
            : typeof props.status?.rssi === 'number'
              ? props.status.rssi
              : null;
    return typeof rssi === 'number' ? `${rssi} dBm` : '—';
});
const activeChannelText = computed(() =>
    typeof overview.value?.activeChannelLabel === 'string' &&
    overview.value.activeChannelLabel.trim()
        ? overview.value.activeChannelLabel
        : ''
);
const lastEventText = computed(
    () =>
        overview.value?.lastEventSummary ||
        overview.value?.lastEvent ||
        'No recent events'
);
const lastUpdatedText = computed(() =>
    formatTimestamp(
        overview.value?.lastUpdatedTs ?? props.status?.last_updated_ts ?? null
    )
);
const productLine = computed(() => {
    const parts: string[] = [];
    // Skip productName when title already shows it (un-renamed device where
    // displayName was auto-set to productName — would otherwise duplicate).
    if (productName.value && productName.value !== title.value) {
        parts.push(productName.value);
    }
    if (modelId.value) parts.push(modelId.value);
    if (address.value && address.value !== '—') parts.push(address.value);
    return parts.join(' / ');
});
const controls = computed(() =>
    Array.isArray(overview.value?.controls) ? overview.value.controls : []
);
const sensors = computed(() =>
    Array.isArray(overview.value?.sensors) ? overview.value.sensors : []
);

function formatKind(value?: string): string {
    if (!value) return 'Sensor';
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimestamp(ts: number | null | undefined): string {
    if (!ts) return 'Never';

    const diffSeconds = Math.max(0, Math.floor(now.value / 1000 - ts));
    if (diffSeconds < 60) return 'Just now';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} min ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} h ago`;

    return new Date(ts * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
</script>

<style scoped>
/* Shell — matches board-tabs visual language */
.bth-board {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.bth-board__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    flex-shrink: 0;
}

.bth-board__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: none;
    background: none;
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}

.bth-board__back:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

.bth-board__frame {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

.bth-board__title {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4) var(--space-2);
    text-align: center;
}

.bth-board__eyebrow {
    display: block;
    font-size: var(--type-card-footer);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-1);
}

.bth-board__name {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: var(--leading-snug);
}

.bth-board__sub {
    margin: var(--space-1) 0 0;
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    word-break: break-word;
}

/* Scrollable content area */
.bth-board__panel {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.bth-board__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.bth-board__section-title {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-card-footer);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    padding-top: var(--space-2);
}

/* Key-value rows (grouped in a card) */
.bth-board__meta {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.bth-board__meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
}

.bth-board__meta-row:last-child {
    border-bottom: none;
}

.bth-board__meta-label {
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
}

.bth-board__meta-value {
    font-size: var(--type-card-footer);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    text-align: right;
    word-break: break-all;
}

.bth-board__mono {
    font-family: var(--font-mono);
}

/* Control cards grid — uniform fixed cells (auto-fill, never stretched) so
   every channel card is one consistent size, matching the device-card rhythm. */
.bth-board__controls {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--grid-cell, 200px));
    justify-content: start;
    gap: var(--card-grid-gap, 12px);
}

.bth-board__control {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-card);
    background: var(--color-surface-2);
}

.bth-board__control--active {
    border-color: var(--color-border-focus);
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface-2));
}

.bth-board__control-label {
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
}

.bth-board__control-value {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

/* Sensor rows (grouped in a card) */
.bth-board__sensors {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.bth-board__sensor {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
}

.bth-board__sensor:last-child {
    border-bottom: none;
}

.bth-board__sensor-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
}

.bth-board__sensor-label {
    font-size: var(--type-card-footer);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
}

.bth-board__sensor-value {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.bth-board__sensor-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
}

.bth-board__empty {
    font-size: var(--type-card-footer);
    color: var(--color-text-tertiary);
    padding: var(--space-2) var(--space-3);
}
</style>
