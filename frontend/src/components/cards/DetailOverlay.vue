<template>
    <DetailOverlayShell
        :visible="visible"
        :data-type="normalizedType"
        @close="$emit('close')"
        @after-leave="$emit('after-leave')"
    >
        <template #default="{close, titleId}">
            <!-- Hero band: device identity (constant across entity types) -->
            <div class="do-hero">
                <div class="do-hero-top">
                    <div class="do-photo">
                        <img
                            v-if="deviceImage && !imageBroken"
                            :src="deviceImage"
                            :alt="entity.name"
                            class="do-photo-img"
                            @error="imageBroken = true"
                        />
                        <i v-else :class="icon" />
                    </div>
                    <div class="do-hero-id">
                        <span :id="titleId" class="do-name">{{ entity.name }}</span>
                        <span v-if="mac" class="do-mac">{{ mac }}</span>
                        <div class="do-tags">
                            <span class="do-tag" :class="statusClass">
                                <i :class="statusIcon" aria-hidden="true" /> {{ statusText }}
                                <template v-if="lastSeenText && !isOnline"> · {{ lastSeenText }}</template>
                            </span>
                            <span v-if="gen" class="do-tag">Gen {{ gen }}</span>
                            <span v-if="model" class="do-tag do-tag--mono">{{ model }}</span>
                        </div>
                    </div>
                    <button type="button" class="do-close" @click="close" aria-label="Close">
                        <i class="fas fa-xmark" aria-hidden="true" />
                    </button>
                </div>
            </div>

            <!-- Tab switch + size picker -->
            <div class="do-controls">
                <ViewToggle v-model="activeTab" :options="tabs" />
                <SizePicker
                    v-if="canResize && allowedSizes.length > 1"
                    :size="activeSize"
                    :allowed-sizes="allowedSizes"
                    @change="$emit('update:size', $event)"
                />
            </div>

            <!-- Tab content (no crossfade — instant switch) -->
            <div class="do-content">
                <!-- Info tab: entity template, in a consistent frame -->
                <div v-if="activeTab === 'info'" class="do-tab-panel">
                    <div class="do-info-frame">
                        <DetailContent
                            :entity="entity"
                            :device="device"
                            :status="entityStatus"
                            :settings="entitySettings"
                            :can-execute="canExecute"
                        />
                    </div>
                </div>

                <!-- Charts tab: one chart per measured quantity, one shared range -->
                <div v-else-if="activeTab === 'charts' && chartMetrics.length" class="do-tab-panel do-charts">
                    <ChartRangeTabs v-model="chartRange" class="do-charts-range" />
                    <LazyMount
                        v-for="m in chartMetrics"
                        :key="m"
                        :min-height="230"
                    >
                        <DetailMetricChart
                            :shelly-id="entity.source"
                            :metric="m"
                            :channel="entity.properties.id"
                            :source="entitySensorSource"
                            :range="chartRange"
                        />
                    </LazyMount>
                </div>

                <!-- Debug tab: entity, status and settings as one
                     searchable, colour-coded JSON view -->
                <div v-else-if="activeTab === 'debug'" class="do-tab-panel">
                    <JSONViewer :data="debugData" expand />
                </div>
            </div>
        </template>
    </DetailOverlayShell>
</template>

<script setup lang="ts">
import type {SensorSource} from '@api/sensor';
import {computed, ref, watch} from 'vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import LazyMount from '@/components/core/LazyMount.vue';
import ViewToggle from '@/components/core/ViewToggle.vue';
import type {ChartRange} from '@/composables/useChartData';
import {entityChartMetrics} from '@/composables/useChartData';
import {getEntityIcon} from '@/config/entity-registry';
import {normalizeCardType} from '@/helpers/card-accents';
import {formatMac, getLogo} from '@/helpers/device';
import {
    allowedSizesForEntity,
    clampSizeForEntity
} from '@/helpers/widgetCatalog';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {entity_t} from '@/types';
import ChartRangeTabs from './ChartRangeTabs.vue';
import DetailContent from './DetailContent.vue';
import DetailMetricChart from './DetailMetricChart.vue';
import DetailOverlayShell from './DetailOverlayShell.vue';
import SizePicker from './SizePicker.vue';

/** Map entity type to the key used in device.status / device.settings */
const STATUS_KEY_ALIAS: Record<string, string> = {
    roller: 'cover'
};

/** Singleton entity types — status key is just the type, no :N suffix */
const SINGLETON_TYPES = new Set(['media', 'ui']);

const props = defineProps<{
    canResize: boolean;
    entity: entity_t;
    size: '1x1' | '2x1' | '2x2';
    visible: boolean;
}>();

defineEmits<{
    close: [];
    'update:size': [size: '1x1' | '2x1' | '2x2'];
    'after-leave': [];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const toastStore = useToastStore();

const device = computed(() => deviceStore.devices[props.entity.source]);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const normalizedType = computed(() => normalizeCardType(props.entity.type));
const deviceImage = computed(() => getLogo(device.value));
const imageBroken = ref(false);
const mac = computed(() => {
    const m = device.value?.info?.mac;
    return m ? formatMac(m) : '';
});
const gen = computed(() => device.value?.info?.gen);
const model = computed(() => device.value?.info?.model);
const icon = computed(() =>
    getEntityIcon(props.entity.type, props.entity.properties)
);
// Same per-entity cap the dashboard render enforces, so the picker can't offer a
// size that clamps back (e.g. 2x2 on a single-button BLU remote or a battery).
const allowedSizes = computed(() => allowedSizesForEntity(props.entity));
// A legacy tile can hold an over-cap size; clamp it so the picker highlights the
// size the dashboard actually renders, not a filtered-out option.
const activeSize = computed(() => clampSizeForEntity(props.size, props.entity));

const isSleeping = computed(() => !!device.value?.sleeping);
const isOffline = computed(() => !device.value?.online && !isSleeping.value);
const isOnline = computed(() => !isOffline.value && !isSleeping.value);
const statusText = computed(() =>
    isSleeping.value ? 'Sleeping' : isOffline.value ? 'Offline' : 'Online'
);
const statusClass = computed(() =>
    isSleeping.value
        ? 'do-tag--sleep'
        : isOffline.value
          ? 'do-tag--off'
          : 'do-tag--on'
);
const statusIcon = computed(() =>
    isSleeping.value
        ? 'fas fa-moon'
        : isOffline.value
          ? 'fas fa-circle-xmark'
          : 'fas fa-circle'
);
const lastSeenText = computed(() => {
    const s = device.value?.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return null;
    const diffS = Math.floor(Date.now() / 1000 - ts);
    if (diffS < 60) return 'just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return `${Math.floor(diffS / 86400)}d ago`;
});
const isStale = computed(() => {
    const s = device.value?.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return false;
    return Math.floor(Date.now() / 1000 - ts) > 7200;
});

/** Resolve the status/settings key — handles aliases (roller→cover) and singletons (media) */
function statusKey(e: entity_t): string {
    const type = STATUS_KEY_ALIAS[e.type] ?? e.type;
    if (SINGLETON_TYPES.has(e.type)) return type;
    return `${type}:${e.properties.id}`;
}

const entityStatus = computed(() => {
    const d = device.value;
    if (!d?.status) return undefined;
    const e = props.entity;
    if (e.type === 'temperature' && e.properties.embeddedIn) {
        return d.status[e.properties.embeddedIn]?.temperature;
    }
    return d.status[statusKey(e)];
});

const entitySettings = computed(() => {
    const d = device.value;
    if (!d?.settings) return undefined;
    const e = props.entity;
    if (e.type === 'temperature' && e.properties.embeddedIn) {
        return d.settings[e.properties.embeddedIn]?.temperature;
    }
    return d.settings[statusKey(e)];
});

// Sensor history is read per reading source, and ambient reads leave out a
// device's own chip temperature — so a chip-temperature entity has to ask for
// its own source, or its chart comes back empty.
const entitySensorSource = computed<SensorSource | undefined>(
    () =>
        (props.entity.properties as {sensorSource?: SensorSource})
            .sensorSource ?? undefined
);

// Charts only when the entity has history to plot; a switch has none.
const chartMetrics = computed(() =>
    entityChartMetrics(props.entity.type, entityStatus.value)
);
const chartRange = ref<ChartRange>('24h');
const tabs = computed(() => [
    {value: 'info', label: 'Info'},
    ...(chartMetrics.value.length ? [{value: 'charts', label: 'Charts'}] : []),
    {value: 'debug', label: 'Debug'}
]);

const activeTab = ref('info');

// Debug view: the whole device — entity, info, and every component's live
// status and settings — in one searchable JSON tree.
const debugData = computed(() => ({
    entity: props.entity,
    info: device.value?.info,
    status: device.value?.status,
    settings: device.value?.settings
}));

// Backdrop/focus/scroll-lock plumbing lives in DetailOverlayShell.
// Here: reset the tab and refresh the device record when opening.
watch(
    () => props.visible,
    (v) => {
        if (!v) return;
        activeTab.value = 'info';
        // Fetch full device data (settings may be missing from list view)
        ws.sendRPC('FLEET_MANAGER', 'device.Get', {
            shellyID: props.entity.source
        })
            .then((fullDevice: any) => {
                if (fullDevice) deviceStore.handleNewDevice(fullDevice);
            })
            .catch(() => {
                toastStore.error('Failed to load device details');
            });
    }
);
</script>
