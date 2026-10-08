<template>
    <!-- 1x1 — door glyph + Open/Closed -->
    <CardShell
        v-if="size === '1x1'"
        type="door"
        :name="entity.name"
        :icon="icon"
        size="1x1"
        :is-on="isOpen"
        :is-offline="isOffline"
        :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        extra-class="ec-sensor"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')"
        @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
        @configure="$emit('configure')"
    >
        <template #default>
            <div class="door-body">
                <DoorGlyph :open="isOpen" :size="66" />
                <div role="status" class="door-state" :class="isOpen ? 'is-open' : 'is-closed'">{{ stateText }}</div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2x1 — glyph + Open/Closed hero, columns: Light · Tilt · Opens · RSSI -->
    <CardShell
        v-else-if="size === '2x1'"
        type="door"
        :name="entity.name"
        :icon="icon"
        size="2x1"
        :is-on="isOpen"
        :is-offline="isOffline"
        :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        extra-class="ec-sensor"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')"
        @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
        @configure="$emit('configure')"
    >
        <template #default>
            <div class="ec-split ec-split--40-60">
                <div class="ec-wl">
                    <DoorGlyph :open="isOpen" :size="56" />
                    <div role="status" class="ec-sensor-hero" :class="stateClass">{{ stateText }}</div>
                </div>
                <div class="ec-wr">
                    <div v-if="cols.length" class="door-vals">
                        <div v-for="col in cols" :key="col.label" class="door-val">
                            <div class="ec-wide-col-v" :class="{'ec-wide-col-v--text': col.text}">{{ col.value }}<span v-if="col.unit" class="ec-u" :class="{'ec-u--sup': col.unit === '°'}">{{ col.unit }}</span></div>
                            <div class="ec-wide-col-l">{{ col.label }}</div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :battery="battery" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2x2 — Open/Closed hero + Lux · Tilt · Battery + timeline + stats -->
    <CardShell
        v-else
        type="door"
        :name="entity.name"
        :icon="icon"
        size="2x2"
        :is-on="isOpen"
        :is-offline="isOffline"
        :is-sleeping="isSleeping"
        :edit-mode="editMode"
        :allowed-sizes="allowedSizes"
        extra-class="ec-sensor"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')"
        @cycle-size="$emit('cycle-size')"
        @resize="(s: string) => $emit('resize', s)"
        @configure="$emit('configure')"
    >
        <template #default>
            <div class="ec-hero-top door-hero-top">
                <DoorGlyph :open="isOpen" :size="132" />
                <div role="status" class="ec-hero-top-v door-hero-state" :class="stateClass">{{ stateText }}</div>
                <div v-if="lastSeen" class="ec-hero-top-u">{{ lastSeen }}</div>
            </div>
            <div v-if="cols.length" class="ec-hero-cols">
                <div v-for="col in cols" :key="col.label" class="ec-hero-col">
                    <div class="ec-hero-col-v" :class="{'ec-hero-col-v--text': col.text}">{{ col.value }}<span v-if="col.unit" class="ec-u" :class="{'ec-u--sup': col.unit === '°'}">{{ col.unit }}</span></div>
                </div>
            </div>
            <div v-if="heroStats.length" class="ec-hero-info">
                <div v-for="s in heroStats" :key="s.label" class="ec-hero-stat">
                    <div class="ec-hero-stat-v" :class="{'ec-hero-stat-v--compact': s.value.length > 6}">{{ s.value }}</div>
                    <div class="ec-hero-stat-l">{{ s.label }}</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, h, ref, watch} from 'vue';
import {
    getBThomeBinaryStateWords,
    getBThomeIcon,
    getLightLevelLabel
} from '@/config/bthome-presentation';
import {
    deviceBatteryPercent,
    deviceLastSeen,
    deviceLightLevel,
    deviceLux,
    deviceRssi,
    deviceTilt
} from '@/helpers/deviceReadings';
import {presentStats} from '@/helpers/powerMetrics';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
import {useSensorActivationsToday} from '@/composables/useSensorHistory';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
    resize: [size: string];
    configure: [];
}>();

const allowedSizes = computed(() => allowedSizesForEntity(props.entity));

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const getEntity = (id: string) => entityStore.entities[id];
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const isBThome = computed(() => props.entity.type === 'bthomesensor');
const objName = computed(() => props.entity.properties?.objName ?? '');

const status = computed(() => {
    const e = props.entity;
    return device.value?.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

const isOpen = computed(() => !!status.value?.value);

const stateText = computed(() => {
    if (isBThome.value) {
        const w = getBThomeBinaryStateWords(objName.value);
        return isOpen.value ? w.on : w.off;
    }
    return isOpen.value ? 'Open' : 'Closed';
});
const stateClass = computed(() => (isOpen.value ? 's-open' : 's-closed'));

const icon = computed(() =>
    isBThome.value ? getBThomeIcon(objName.value) : 'fas fa-door-open'
);

// Lux spans 0 to ~100,000 (direct sun), so abbreviate ≥1000 with "k" to keep
// the value short enough for the column.
function fmtLux(v: number): string {
    if (v >= 10000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
}

const battery = computed(() =>
    deviceBatteryPercent(device.value, getEntity)
);

// Opens since local midnight, from device_sensor.events via Sensor.Events.
const opensToday = useSensorActivationsToday(
    computed(() => props.entity),
    isOpen
);

// Wide-card readings, all live:
//   Light + Tilt — sibling BLU sensors on the same device. Light is lux on the
//     old DW (SBDW-002C) and a 3-state level on the ZB DW and newer sensors.
//   Opens — Sensor.Events count since midnight.
//   RSSI — wifi.rssi, or the gateway's measurement of this BLU device.
// Battery is not here: the badge carries it. `text` marks a word value so the
// column can size it to fit. A reading the device does not send is dropped, so
// no "—°" or "— %".
const cols = computed<
    {label: string; value: string; unit?: string; text?: boolean}[]
>(() => {
    const lux = deviceLux(device.value, getEntity);
    const level = deviceLightLevel(device.value, getEntity);
    const tilt = deviceTilt(device.value, getEntity);
    const rssi = deviceRssi(device.value);
    const light =
        lux !== null
            ? {label: 'Light', value: fmtLux(lux), unit: 'lx'}
            : level !== null
              ? {label: 'Light', value: getLightLevelLabel(level), text: true}
              : {label: 'Light', value: '—'};
    return presentStats([
        light,
        {label: 'Tilt', value: tilt !== null ? String(tilt) : '—', unit: '°'},
        {
            label: 'Opens',
            value: opensToday.value !== null ? String(opensToday.value) : '—'
        },
        {label: 'RSSI', value: rssi !== null ? String(rssi) : '—', unit: 'dBm'}
    ]);
});

const lastSeen = computed(() => deviceLastSeen(device.value));

// "Last Open" = the device timestamp of the most recent status we received with
// the sensor open. Each open overwrites it; it survives the following close.
// Only what we've received this session — unknown until the first open arrives.
const lastOpenTs = ref<number | null>(null);
watch(
    status,
    (s) => {
        if (s?.value && typeof s.last_updated_ts === 'number') {
            lastOpenTs.value = s.last_updated_ts;
        }
    },
    {immediate: true}
);

// Last Open as a clock time — with the date prefixed when it wasn't today.
// Kept short (24h time, "8 Jul" style date) so it fits the narrow stat cell.
function formatLastOpen(tsSeconds: number | null): string | null {
    if (!tsSeconds) return null;
    const d = new Date(tsSeconds * 1000);
    const time = d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    if (d.toDateString() === new Date().toDateString()) return time;
    const date = d.toLocaleDateString([], {day: 'numeric', month: 'short'});
    return `${date} ${time}`;
}

// Bottom stats — all live: Opens Today from Sensor.Events, Last Open from the
// device status, RSSI from wifi.rssi / the gateway's BLU measurement.
const heroStats = computed(() => {
    const rssi = deviceRssi(device.value);
    return presentStats([
        {
            value:
                opensToday.value !== null ? String(opensToday.value) : '—',
            label: 'Opens Today'
        },
        {value: formatLastOpen(lastOpenTs.value) ?? '—', label: 'Last Open'},
        {value: rssi !== null ? String(rssi) : '—', label: 'RSSI'}
    ]);
});

// Custom door glyph. Closed = a shut panel; open = the door swung ajar (drawn
// in perspective) with the frame behind — so the two states read differently.
const DoorGlyph = (p: {open: boolean; size: number}) =>
    h(
        'svg',
        {
            width: p.size,
            height: p.size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: p.open
                ? 'var(--color-warning-text)'
                : 'var(--color-status-on)',
            'stroke-width': 1.6,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
            role: 'img',
            'aria-label': stateText.value,
            style: {opacity: p.open ? 0.9 : 0.7}
        },
        p.open
            ? [
                  // doorway/frame behind
                  h('path', {d: 'M15 3l6-1v20l-6-1', opacity: 0.35}),
                  // open leaf swung toward viewer (taller on the hinge side)
                  h('path', {d: 'M3 5L15 2.5v19L3 21z'}),
                  // knob on the open leaf
                  h('circle', {
                      cx: 6,
                      cy: 12,
                      r: 1.1,
                      fill: 'currentColor',
                      stroke: 'none'
                  })
              ]
            : [
                  // shut door panel
                  h('rect', {x: 4, y: 2.5, width: 16, height: 19, rx: 2}),
                  // knob
                  h('circle', {
                      cx: 16.5,
                      cy: 12,
                      r: 1.1,
                      fill: 'currentColor',
                      stroke: 'none'
                  })
              ]
    );
</script>

<style scoped>
/* 1x1 — glyph + state, centered. */
.door-body {
    display: flex;
    flex: 1;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-align: center;
}
.door-state {
    font-size: var(--type-heading);
    font-weight: var(--font-bold);
    line-height: 1;
}
.door-state.is-open {
    color: var(--color-warning-text);
}
.door-state.is-closed {
    color: var(--color-status-on);
}
/* 2x1: drop the shared split's side padding so the left panel spans from the
   card edge to the divider and the right panel spans divider-to-card-end.
   Pin the 40/60 split explicitly — a later base rule (.ec-wide .ec-wl) would
   otherwise force 50/50 and defeat .ec-split--40-60. High specificity so these
   win over the shared rules without ambiguity. */
.ec-sensor.ec-wide .ec-split {
    padding: 0;
}
.ec-sensor.ec-wide .ec-split > .ec-wl {
    flex: 0 0 40%;
    text-align: center;
}
.ec-sensor.ec-wide .ec-split > .ec-wr {
    flex: 0 0 60%;
    display: flex;
    align-items: center;
}
/* Right panel: three values with equal space between each and equal space to
   the divider and the card end (space-evenly). Dedicated classes — the shared
   .ec-col carries flex:1 + column dividers that fight this layout. */
.door-vals {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-evenly;
}
.door-val {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}
/* Word light levels (Dark/Twilight/Bright) don't fit the big numeric size —
   size them down so they sit on one line in the column. */
.ec-wide-col-v--text {
    font-size: clamp(14px, 7cqi, 20px);
    white-space: nowrap;
}
/* 2x2: glyph + state stacked at the top; state text sized to sit under the
   glyph rather than fill the card. */
.door-hero-top {
    padding-top: var(--space-3);
    gap: var(--space-2);
}
/* Free the fixed height the shared values row reserves so the larger glyph
   fits without clipping the stats. */
.ec-hero-cols {
    min-height: 0;
}
.door-hero-state {
    font-size: var(--type-heading);
}
/* 2x2 value units: space a word unit (lx, %), raise the degree. */
/* 2x2 word light level — smaller than the big numeric value so it fits. */
.ec-hero-col-v--text {
    font-size: var(--type-body);
    white-space: nowrap;
}
/* 2x2 bottom stats: three equal sections filling the width between the
   dividers, each value + label centered in its share; value scaled up from the
   default caption size so it reads properly. */
.ec-hero-info {
    flex-wrap: nowrap;
    justify-content: space-between;
}
.ec-hero-stat {
    flex: 1;
    min-width: 0;
}
/* Big by default; single line. Only a long value (Last Open's "8 Jul 14:32")
   drops to the smaller size so it fits — the common "14:32" stays big. */
.ec-hero-stat-v {
    font-size: var(--type-subheading);
    white-space: nowrap;
}
.ec-hero-stat-v--compact {
    font-size: var(--type-body);
}
</style>
