<template>
    <CardShell
        type="ui_widget"
        name="Cross-Site Comparison"
        icon="fas fa-chart-column"
        :size="size"
        :edit-mode="editMode"
        @delete="$emit('delete')"
        @resize="(s: any) => $emit('resize', s)"
        @move="(d: any) => $emit('move', d)"
        @drag-start="(e: DragEvent) => $emit('drag-start', e)"
        @drag-end="(e: DragEvent) => $emit('drag-end', e)"
        @drag-over="(e: DragEvent) => $emit('drag-over', e)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent) => $emit('drop', e)"
    >
        <div class="csbc">
            <div v-if="loading" class="csbc-body">
                <Skeleton v-for="n in 5" :key="n" variant="row" />
            </div>
            <p v-else-if="failed" class="csbc-empty">
                <i class="fas fa-triangle-exclamation" /> Failed to load
            </p>
            <div v-else-if="!bars.length" class="csbc-empty">No data</div>
            <div v-else class="csbc-body">
                <div class="csbc-bars">
                    <div v-for="bar in bars" :key="bar.id" class="csbc-row">
                        <span class="csbc-label" :title="bar.name">{{ bar.name }}</span>
                        <div class="csbc-track">
                            <div
                                class="csbc-fill"
                                :style="{width: bar.pct + '%', background: chartColors.chart1}"
                            />
                        </div>
                        <span class="csbc-val">{{ bar.label }}</span>
                    </div>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onScopeDispose, ref, watch} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {useSiteLocations} from '@/composables/useSiteLocations';
import {chartColors} from '@/helpers/chartUtils';
import {
    formatKilowattHours,
    formatPower,
    metricText
} from '@/helpers/powerMetrics';
import {useDevicesStore} from '@/stores/devices';
import {extractDevicePower} from '@/stores/energyDashboard';
import * as ws from '@/tools/websocket';
import CardShell from './CardShell.vue';

export type CrossSiteMetric =
    | 'energy_24h'
    | 'energy_7d'
    | 'energy_30d'
    | 'live_power';

export interface CrossSiteBarChartWidgetConfig {
    id: 'cross_site_bar_widget';
    locationIds?: number[];
    metric: CrossSiteMetric;
    limit?: number;
}

const props = withDefaults(
    defineProps<{
        config: CrossSiteBarChartWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x1', editMode: false}
);

defineEmits<{
    delete: [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    move: [direction: number];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
}>();

const devicesStore = useDevicesStore();
const siteLocations = useSiteLocations(
    computed(() => props.config.locationIds)
);
const {allDeviceIds, deviceIdsByRoot} = useLocationDeviceScope(
    computed(() => siteLocations.value.map((loc) => loc.id))
);

// Energy data from RPC — only used for energy_* metrics
const loading = ref(false);
const failed = ref(false);
const energyByLocation = ref<Map<number, number>>(new Map());

let abortId = 0;
let disposed = false;
onScopeDispose(() => {
    disposed = true;
});

async function fetchEnergy() {
    if (props.config.metric === 'live_power') {
        energyByLocation.value = new Map();
        loading.value = false;
        return;
    }
    const id = ++abortId;
    loading.value = true;
    failed.value = false;
    const daysBack =
        props.config.metric === 'energy_24h'
            ? 1
            : props.config.metric === 'energy_7d'
              ? 7
              : 30;
    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 86400_000);
    try {
        const siteByDevice = new Map<string, number>();
        const rows: Array<[number, number]> = siteLocations.value.map(
            (site) => [site.id, 0]
        );
        for (const site of siteLocations.value) {
            for (const deviceId of deviceIdsByRoot.value[site.id] ?? []) {
                siteByDevice.set(deviceId, site.id);
            }
        }
        if (allDeviceIds.value.length > 0) {
            const res = await ws.sendRPC<{
                items?: Array<{shellyID?: string | null; value: number}>;
            }>('FLEET_MANAGER', 'energy.query', {
                from: from.toISOString(),
                to: to.toISOString(),
                tags: ['total_act_energy'],
                // AC grid electricity — exclude DC / other commodities.
                commodity: 'electricity',
                electricalSource: 'ac_mains',
                bucket: '1 day',
                devices: allDeviceIds.value,
                perDevice: true,
                limit: Math.max(allDeviceIds.value.length * (daysBack + 2), 100)
            });
            const totals = new Map(rows);
            for (const row of res.items ?? []) {
                const siteId =
                    typeof row.shellyID === 'string'
                        ? siteByDevice.get(row.shellyID)
                        : undefined;
                if (siteId == null) continue;
                totals.set(
                    siteId,
                    (totals.get(siteId) ?? 0) + (Number(row.value) || 0)
                );
            }
            if (disposed || id !== abortId) return;
            energyByLocation.value = totals;
            return;
        }
        if (disposed || id !== abortId) return;
        energyByLocation.value = new Map(rows);
    } catch {
        // Say so. Swallowing this left the last good kWh on screen forever.
        if (disposed || id !== abortId) return;
        energyByLocation.value = new Map();
        failed.value = true;
    } finally {
        if (!disposed && id === abortId) loading.value = false;
    }
}

watch(
    () => [
        props.config.metric,
        ...siteLocations.value.map((site) => site.id),
        ...allDeviceIds.value
    ],
    fetchEnergy,
    {immediate: true}
);

// Without this the card showed mount-time energy forever on a wall dashboard.
const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => fetchEnergy()
);

function groupLivePower(devices: string[]): number {
    return devices.reduce(
        (s, sid) => s + extractDevicePower(devicesStore.devices[sid]?.status),
        0
    );
}

const bars = computed(() => {
    const limit = props.config.limit ?? 10;
    const isLive = props.config.metric === 'live_power';

    const raw = siteLocations.value.map((site) => {
        const deviceIds = deviceIdsByRoot.value[site.id] ?? [];
        const val = isLive
            ? groupLivePower(deviceIds)
            : (energyByLocation.value.get(site.id) ?? 0);
        return {id: site.id, name: site.name, val};
    });

    raw.sort((a, b) => b.val - a.val);
    const top = raw.slice(0, limit);
    const maxVal = Math.max(...top.map((r) => r.val), 1);

    return top.map((r) => ({
        id: r.id,
        name: r.name,
        pct: (r.val / maxVal) * 100,
        label: isLive
            ? metricText(formatPower(r.val))
            : metricText(formatKilowattHours(r.val))
    }));
});

</script>

<style scoped>
.csbc {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.csbc-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.csbc-body {
    flex: 1;
    overflow: auto;
    min-height: 0;
    padding: var(--space-1) var(--space-0-5);
}

.csbc-bars {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}

.csbc-row {
    display: grid;
    grid-template-columns: 64px 1fr 52px;
    align-items: center;
    gap: var(--space-1-5);
}

.csbc-label {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.csbc-track {
    height: 8px;
    background: var(--state-hover-bg-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
}

.csbc-fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: width 0.3s ease;
}

.csbc-val {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
}
</style>
