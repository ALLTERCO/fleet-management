<template>
    <!-- 1x1 — battery visual + % (both device types) -->
    <CardShell
        v-if="size === '1x1'"
        type="battery"
        :name="entity.name"
        :icon="icon"
        size="1x1"
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
            <div class="batt-body">
                <div class="batt-shell">
                    <div class="batt-fill" :class="levelClass" :style="{ width: fillPct + '%' }" />
                </div>
                <div class="batt-readout">{{ percentText }}<span class="batt-unit">%</span></div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" hide-battery />
        </template>
    </CardShell>

    <!-- 2x1 and 2x2 — WiFi sleeper: level + voltage + power source + last seen.
         v-else so a 2x2 card renders this layout instead of blank. -->
    <CardShell
        v-else
        type="battery"
        :name="entity.name"
        :icon="icon"
        :size="size"
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
                <div class="batt-body">
                    <div class="batt-shell">
                        <div class="batt-fill" :class="levelClass" :style="{ width: fillPct + '%' }" />
                    </div>
                    <div class="batt-readout">{{ percentText }}<span class="batt-unit">%</span></div>
                </div>
                <div class="ec-wr">
                    <div class="ec-cols">
                        <div v-for="col in stats" :key="col.label" class="ec-col">
                            <div class="ec-wide-col-v">{{ col.value }}</div>
                            <div class="ec-wide-col-l">{{ col.label }}</div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" hide-battery />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {deviceLastSeen} from '@/helpers/deviceReadings';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
import {useDevicesStore} from '@/stores/devices';
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
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);

const status = computed(() => {
    const e = props.entity;
    return device.value?.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

// WiFi sleepers carry battery on devicepower (percent + volts); BLU devices put
// the level in the BTHome sensor's own value.
const percent = computed<number | null>(() => {
    const dpPercent = status.value?.battery?.percent;
    if (typeof dpPercent === 'number') return dpPercent;
    const bluValue = status.value?.value;
    return typeof bluValue === 'number' ? bluValue : null;
});

const percentText = computed(() =>
    percent.value !== null ? String(Math.round(percent.value)) : '—'
);
const fillPct = computed(() => Math.max(0, Math.min(100, percent.value ?? 0)));
const levelClass = computed(() => {
    if (percent.value === null) return '';
    if (percent.value <= 10) return 'batt-fill--crit';
    if (percent.value <= 30) return 'batt-fill--low';
    return '';
});

const icon = computed(() => {
    const p = percent.value ?? 100;
    if (p <= 10) return 'fas fa-battery-empty';
    if (p <= 25) return 'fas fa-battery-quarter';
    if (p <= 50) return 'fas fa-battery-half';
    if (p <= 75) return 'fas fa-battery-three-quarters';
    return 'fas fa-battery-full';
});

// Voltage and external power come only from a devicepower component. External
// power is present in status only when the hardware supports it.
const voltage = computed<string | null>(() => {
    const v = status.value?.battery?.V;
    return typeof v === 'number' ? `${v.toFixed(2)} V` : null;
});
const powerSource = computed<string | null>(() => {
    const external = status.value?.external;
    if (!external || typeof external.present !== 'boolean') return null;
    return external.present ? 'Plugged in' : 'On battery';
});

const lastSeen = computed<string | null>(() => deviceLastSeen(device.value));

// Only the stats the device actually reports — no empty cells.
const stats = computed(() => {
    const out: {label: string; value: string}[] = [];
    if (voltage.value) out.push({label: 'Voltage', value: voltage.value});
    if (powerSource.value) out.push({label: 'Power', value: powerSource.value});
    if (lastSeen.value) out.push({label: 'Last seen', value: lastSeen.value});
    return out;
});
</script>

<style scoped>
/* The battery visual + readout, centered — this card's whole job is the level. */
.batt-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
}
.batt-shell {
    position: relative;
    width: 116px;
    height: 54px;
    overflow: hidden;
    border: 2.5px solid var(--color-border-strong);
    border-radius: var(--radius-md);
}
.batt-shell::after {
    content: "";
    position: absolute;
    top: 17px;
    right: -7px;
    width: 4px;
    height: 20px;
    background: var(--color-border-strong);
    border-radius: 0 2px 2px 0;
}
.batt-fill {
    height: 100%;
    background: var(--color-success);
    transition: width var(--duration-normal) ease;
}
.batt-fill--low {
    background: var(--color-warning);
}
.batt-fill--crit {
    background: var(--color-danger);
}
/* Number in the shared gradient value style; the unit gets its own solid
   colour so it stays visible (gradient-clipped text renders a nested unit
   span nearly transparent). */
/* The number is centred under the battery shell; the unit is taken out of flow
   so its width doesn't shift the number off-centre. */
.batt-readout {
    position: relative;
    font-size: var(--type-heading);
    font-weight: 800;
    line-height: 1;
    background: var(--gradient-value-text);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.batt-unit {
    position: absolute;
    left: 100%;
    bottom: 0.06em;
    margin-left: 3px;
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    -webkit-text-fill-color: var(--color-text-secondary);
}
</style>
