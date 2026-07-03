<template>
    <CardShell
        type="ui_widget"
        name="Site Grid"
        icon="fas fa-grip"
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
        <div class="sg">
            <div v-if="!sites.length" class="sg-empty">No sites configured</div>
            <div v-else class="sg-grid">
                <div
                    v-for="site in sites"
                    :key="site.id"
                    class="sg-tile"
                    :class="[statusClass(site), config.drilldownDashId ? 'sg-tile--clickable' : '']"
                    @click="onTileClick(site.id)"
                >
                    <div class="sg-tile-header">
                        <span class="sg-dot" :class="dotClass(site)" />
                        <span class="sg-name" :title="site.name">{{ site.name }}</span>
                    </div>
                    <div class="sg-metric">{{ metricLabel(site) }}</div>
                    <div class="sg-footer">
                        <span>{{ site.onlineCount }}/{{ site.totalCount }} online</span>
                        <span v-if="site.alerts > 0" class="sg-alert-badge">{{ site.alerts }} !</span>
                    </div>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useRouter} from 'vue-router';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useLocationsStore} from '@/stores/locations';
import CardShell from './CardShell.vue';

export interface SiteGridWidgetConfig {
    id: 'site_grid_widget';
    locationIds?: number[];
    metric: 'power' | 'devices' | 'alerts';
    drilldownDashId?: number;
}

const props = withDefaults(
    defineProps<{
        config: SiteGridWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x2', editMode: false}
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

const locationsStore = useLocationsStore();
const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const router = useRouter();

const siteLocations = computed(() => {
    const allSites = Object.values(locationsStore.locations)
        .filter((loc) => loc.kind === 'site')
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!props.config.locationIds?.length) return allSites;
    const allow = new Set(props.config.locationIds);
    return allSites.filter((loc) => allow.has(loc.id));
});

const {deviceIdsByRoot} = useLocationDeviceScope(
    computed(() => siteLocations.value.map((loc) => loc.id))
);

function onTileClick(locationId: number) {
    if (!props.config.drilldownDashId || props.editMode) return;
    router.push({
        name: '/dash/[id]',
        params: {id: props.config.drilldownDashId},
        query: {locationId: String(locationId)}
    });
}

function devicePower(shellyId: string): number {
    const d = devicesStore.devices[shellyId] as any;
    if (!d?.status) return 0;
    let pw = 0;
    for (const key of Object.keys(d.status)) {
        if (
            key.startsWith('switch:') ||
            key.startsWith('pm1:') ||
            key.startsWith('em:') ||
            key.startsWith('em1:')
        ) {
            const ch = d.status[key];
            pw += +(ch?.apower ?? ch?.act_power ?? 0);
        }
    }
    return pw;
}

// Build alert count per shellyId once — O(entities) instead of O(devices × entities)
const alertsByShelly = computed<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const e of Object.values(entityStore.entities) as any[]) {
        const active =
            (e.type === 'flood' &&
                (e.status?.alarm === true || e.status?.flood === true)) ||
            (e.type === 'smoke' && e.status?.alarm === true);
        if (active) m.set(e.source, (m.get(e.source) ?? 0) + 1);
    }
    return m;
});

const sites = computed(() => {
    return siteLocations.value.map((loc) => {
        const deviceIds = deviceIdsByRoot.value[loc.id] ?? [];
        const totalCount =
            loc.counts?.descendantDevices ?? loc.counts?.devices ?? deviceIds.length;
        const onlineCount = deviceIds.filter(
            (sid) => devicesStore.devices[sid]?.online
        ).length;
        const alerts = deviceIds.reduce(
            (s, sid) => s + (alertsByShelly.value.get(sid) ?? 0),
            0
        );
        const powerW = deviceIds.reduce((s, sid) => s + devicePower(sid), 0);
        return {
            id: loc.id,
            name: loc.name,
            totalCount,
            onlineCount,
            alerts,
            powerW
        };
    });
});

function statusClass(site: (typeof sites.value)[number]) {
    if (site.alerts > 0) return 'sg-tile--critical';
    if (site.onlineCount < site.totalCount) return 'sg-tile--warn';
    return 'sg-tile--ok';
}

function dotClass(site: (typeof sites.value)[number]) {
    if (site.alerts > 0) return 'sg-dot--red';
    if (site.onlineCount < site.totalCount) return 'sg-dot--amber';
    if (site.totalCount === 0) return 'sg-dot--grey';
    return 'sg-dot--green';
}

function metricLabel(site: (typeof sites.value)[number]): string {
    const m = props.config.metric;
    if (m === 'power') {
        const w = site.powerW;
        return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
    }
    if (m === 'alerts')
        return `${site.alerts} alert${site.alerts !== 1 ? 's' : ''}`;
    return `${site.totalCount} device${site.totalCount !== 1 ? 's' : ''}`;
}
</script>

<style scoped>
.sg {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.sg-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.sg-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: var(--space-1-5);
    padding: var(--space-1);
    overflow: auto;
    min-height: 0;
}

.sg-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm-plus);
    background: var(--state-hover-bg);
    border: 1px solid var(--color-border-default);
    min-width: 0;
}

.sg-tile--critical {
    border-color: rgba(var(--color-danger-rgb), 0.35);
    background: rgba(var(--color-danger-rgb), 0.07);
}

.sg-tile--warn {
    border-color: rgba(var(--color-warning-rgb), 0.35);
    background: rgba(var(--color-warning-rgb), 0.06);
}

.sg-tile--clickable {
    cursor: pointer;
}

.sg-tile--clickable:hover {
    filter: brightness(1.15);
}

.sg-tile-header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.sg-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.sg-dot--green  { background: var(--color-status-on); }
.sg-dot--amber  { background: var(--color-status-warn); }
.sg-dot--red    { background: var(--color-status-red); }
.sg-dot--grey   { background: var(--color-text-disabled); }

.sg-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sg-metric {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}

.sg-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.sg-alert-badge {
    background: rgba(var(--color-danger-rgb), 0.8);
    color: var(--color-text-primary);
    border-radius: var(--radius-xs);
    padding: 0 3px;
    font-size: var(--type-body);
    font-weight: 700;
}
</style>
