<template>
    <CardShell
        type="ui_widget"
        name="Fleet KPIs"
        icon="fas fa-layer-group"
        :size="size"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
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
            <div class="fkpi-grid">
                <div class="fkpi-tile">
                    <i class="fkpi-icon fas fa-location-dot" aria-hidden="true" />
                    <span class="fkpi-val">{{ siteCount }}</span>
                    <span class="fkpi-label">Sites</span>
                </div>
                <div class="fkpi-divider" />
                <div class="fkpi-tile" :class="{'fkpi-tile--warn': offlineCount > 0}">
                    <i class="fkpi-icon fas fa-microchip" aria-hidden="true" />
                    <span class="fkpi-val">{{ onlineCount }}<span class="fkpi-sub">/{{ totalDevices }}</span></span>
                    <span class="fkpi-label">Online</span>
                </div>
                <div class="fkpi-divider" />
                <div class="fkpi-tile">
                    <i class="fkpi-icon fas fa-bolt" aria-hidden="true" />
                    <span class="fkpi-val">{{ metricText(formatPower(totalPowerW)) }}</span>
                    <span class="fkpi-label">Power</span>
                </div>
                <div class="fkpi-divider" />
                <RouterLink
                    to="/alerts"
                    class="fkpi-tile fkpi-tile--link"
                    :class="{'fkpi-tile--alert': activeAlerts > 0}"
                    @click.stop
                >
                    <i class="fkpi-icon fas fa-triangle-exclamation" aria-hidden="true" />
                    <span class="fkpi-val">{{ activeAlerts }}</span>
                    <span class="fkpi-label">Alerts</span>
                </RouterLink>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {formatPower, metricText} from '@/helpers/powerMetrics';
import {allowedSizesForWidget} from '@/helpers/widgetCatalog';
import {useAlertsStore} from '@/stores/alerts';
import {useDevicesStore} from '@/stores/devices';
import {extractDevicePower} from '@/stores/energyDashboard';
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

// The size picker must not offer 1x1 — the renderer clamps it away anyway.
const allowedSizes = allowedSizesForWidget('fleet_kpi_strip_widget');

const locationsStore = useLocationsStore();
const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const alertsStore = useAlertsStore();

// Alert instances load lazily (alerts page, bell popover) — a dashboard
// widget must trigger the same guarded fetch itself or it counts an empty
// store. Latest-wins in the store; live updates arrive over WS afterwards.
onMounted(() => {
    void alertsStore.fetchInstances({state: 'active'});
});

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

// Shared rule: reading only `apower` counted a 3-phase meter as 0 W.
const totalPowerW = computed(() =>
    allDevices.value.reduce((sum, d) => sum + extractDevicePower(d.status), 0)
);

// Flood/smoke alarm flags arrive with the entity snapshot, so they stand in
// only until the first instance fetch settles — never added on top.
const sensorAlarmCount = computed(
    () =>
        Object.values(entityStore.entities).filter((e: any) => {
            if (e.type === 'flood')
                return e.status?.alarm === true || e.status?.flood === true;
            if (e.type === 'smoke') return e.status?.alarm === true;
            return false;
        }).length
);

// Loaded-once latch: a later refetch flips instancesLoading again and must
// not flap the tile back to the sensor stand-in.
const instancesLoaded = ref(false);
watch(
    () => alertsStore.instancesLoading,
    (loading) => {
        if (!loading) instancesLoaded.value = true;
    },
    {immediate: true}
);

// Active rule instances are the number the /alerts page shows.
const activeAlerts = computed(() =>
    instancesLoaded.value
        ? Object.values(alertsStore.instances).filter(
              (inst) => inst.state === 'active'
          ).length
        : sensorAlarmCount.value
);

</script>

<style scoped>
/* Size container: the strip reflows by its own width, because the phone
   media query collapses wide/hero cards down to a single narrow grid cell. */
.fkpi {
    container-type: inline-size;
    width: 100%;
    height: 100%;
}

/* 2x1 leaves horizontal padding to .ec-val so the strip is not double padded. */
.fkpi-grid {
    display: flex;
    align-items: center;
    justify-content: space-around;
    width: 100%;
    height: 100%;
    padding: var(--space-2) 0;
    gap: var(--space-1);
}

.fkpi-divider {
    width: 1px;
    align-self: stretch;
    margin: var(--space-3) 0;
    background: var(--color-border-subtle);
    flex-shrink: 0;
}

.fkpi-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
    text-decoration: none;
}

.fkpi-icon {
    font-size: var(--icon-size-sm);
    color: var(--color-text-tertiary);
}

/* The number carries the weight; cqi tracks the strip width so it shrinks
   toward body size instead of wrapping mid-number. */
.fkpi-val {
    font-size: clamp(var(--type-body), 7cqi, var(--type-subheading));
    font-weight: var(--font-black);
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-tight);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.fkpi-sub {
    font-size: var(--type-body);
    font-weight: var(--font-normal);
    color: var(--color-text-tertiary);
}

.fkpi-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
}

/* 2x2 — a 2x2 tile grid instead of one row stretched over the whole body.
   Gap separates the tiles, so no full-height hairline dividers. */
.ec-hero .fkpi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    place-items: center;
    padding: var(--space-4);
    gap: var(--space-2);
}

.ec-hero .fkpi-divider {
    display: none;
}

.ec-hero .fkpi-val {
    font-size: var(--type-heading);
}

/* State, not outcome — device/fleet health uses the status ramp. */
.fkpi-tile--warn .fkpi-val {
    color: var(--color-status-warn);
}

.fkpi-tile--warn .fkpi-icon {
    color: var(--color-status-warn);
}

.fkpi-tile--alert .fkpi-val,
.fkpi-tile--alert .fkpi-icon {
    color: var(--color-status-red);
}

.fkpi-tile--link {
    border-radius: var(--radius-md);
    transition: background var(--duration-normal);
}

.fkpi-tile--link:hover {
    background: var(--glass-hover);
}

.fkpi-tile--link:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: -2px;
}

/* Narrower than a 4-across strip can read (the phone cell): two columns of
   tiles. The val rule sits last so it outranks the hero heading size when a
   hero card is collapsed to one cell. */
@container (max-width: 340px) {
    .fkpi-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        place-items: center;
        height: auto;
        row-gap: var(--space-2);
    }

    .fkpi-divider {
        display: none;
    }

    .fkpi-grid .fkpi-val {
        font-size: clamp(var(--type-body), 7cqi, var(--type-subheading));
    }
}
</style>
