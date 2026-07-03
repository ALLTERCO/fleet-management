<template>
    <CardShell
        type="ui_widget"
        name="Fleet KPIs"
        icon="fas fa-layer-group"
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
        <div class="fkpi">
            <div class="fkpi-tile">
                <span class="fkpi-val">{{ siteCount }}</span>
                <span class="fkpi-label">Sites</span>
            </div>
            <div class="fkpi-divider" />
            <div class="fkpi-tile" :class="{'fkpi-tile--warn': offlineCount > 0}">
                <span class="fkpi-val">{{ onlineCount }}<span class="fkpi-sub">/{{ totalDevices }}</span></span>
                <span class="fkpi-label">Devices Online</span>
            </div>
            <div class="fkpi-divider" />
            <div class="fkpi-tile">
                <span class="fkpi-val">{{ fmtPower(totalPowerW) }}</span>
                <span class="fkpi-label">Live Power</span>
            </div>
            <div class="fkpi-divider" />
            <div class="fkpi-tile" :class="{'fkpi-tile--alert': activeAlerts > 0}">
                <span class="fkpi-val">{{ activeAlerts }}</span>
                <span class="fkpi-label">Active Alerts</span>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useLocationsStore} from '@/stores/locations';
import CardShell from './CardShell.vue';

export interface FleetKPIStripWidgetConfig {
    id: 'fleet_kpi_strip_widget';
}

withDefaults(
    defineProps<{
        config: FleetKPIStripWidgetConfig;
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

const locationsStore = useLocationsStore();
const devicesStore = useDevicesStore();
const entityStore = useEntityStore();

const siteLocationIds = computed(() =>
    Object.values(locationsStore.locations)
        .filter((loc) => loc.kind === 'site')
        .map((loc) => loc.id)
);
const {allDeviceIds} = useLocationDeviceScope(siteLocationIds);

const siteCount = computed(
    () => siteLocationIds.value.length
);

const allDevices = computed(() =>
    allDeviceIds.value.length > 0
        ? allDeviceIds.value
              .map((id) => devicesStore.devices[id])
              .filter((device): device is NonNullable<typeof device> => !!device)
        : Object.values(devicesStore.devices)
);

const totalDevices = computed(() => allDevices.value.length);

const onlineCount = computed(
    () => allDevices.value.filter((d) => d.online).length
);

const offlineCount = computed(() => totalDevices.value - onlineCount.value);

const totalPowerW = computed(() =>
    allDevices.value.reduce((sum, d) => {
        const s = d.status;
        if (!s) return sum;
        // Sum all switch/pm1/em channels
        let pw = 0;
        for (const key of Object.keys(s)) {
            if (
                key.startsWith('switch:') ||
                key.startsWith('pm1:') ||
                key.startsWith('em:') ||
                key.startsWith('em1:')
            ) {
                const ch = s[key];
                pw += +(ch?.apower ?? ch?.act_power ?? 0);
            }
        }
        return sum + pw;
    }, 0)
);

const activeAlerts = computed(
    () =>
        Object.values(entityStore.entities).filter((e: any) => {
            if (e.type === 'flood')
                return e.status?.alarm === true || e.status?.flood === true;
            if (e.type === 'smoke') return e.status?.alarm === true;
            return false;
        }).length
);

function fmtPower(w: number): string {
    if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
    return `${Math.round(w)} W`;
}
</script>

<style scoped>
.fkpi {
    display: flex;
    align-items: center;
    justify-content: space-around;
    width: 100%;
    height: 100%;
    padding: var(--space-1) var(--space-2);
    gap: var(--space-1);
}

.fkpi-divider {
    width: 1px;
    height: 32px;
    background: var(--state-hover-bg-strong);
    flex-shrink: 0;
}

.fkpi-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
    flex: 1;
}

.fkpi-val {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
    line-height: 1;
}

.fkpi-sub {
    font-size: var(--type-body);
    font-weight: 400;
    color: var(--color-text-tertiary);
}

.fkpi-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: none;
    letter-spacing: 0.05em;
    white-space: nowrap;
}

.fkpi-tile--warn .fkpi-val {
    color: var(--color-warning-text);
}

.fkpi-tile--alert .fkpi-val {
    color: var(--color-danger-text);
}
</style>
