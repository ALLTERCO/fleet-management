<template>
    <!-- 1x1 — temperature, centered -->
    <CardShell
        v-if="size === '1x1'"
        type="temperature"
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
            <div class="temp-body">
                <div class="temp-readout">{{ tempText }}<span class="temp-unit">°C</span></div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2x1 / 2x2 — temperature hero + health stats -->
    <CardShell
        v-else
        type="temperature"
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
            <div class="temp-hero">
                <div class="temp-readout temp-readout--hero">{{ tempText }}<span class="temp-unit">°C</span></div>
                <div v-if="stats.length" class="temp-stats">
                    <div v-for="s in stats" :key="s.label" class="temp-stat">
                        <div class="temp-stat-v">{{ s.value }}</div>
                        <div class="temp-stat-l">{{ s.label }}</div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {deviceBatteryPercent, deviceLastSeen} from '@/helpers/deviceReadings';
import {allowedSizesForEntity} from '@/helpers/widgetCatalog';
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
// Synthetic entity for a device's internal (chip) temperature — the reading is
// embedded in another component (e.g. light:0.temperature), not a standalone
// temperature:N. properties.embeddedIn names that component.
const isInternalTemp = computed(() => !!props.entity.properties?.embeddedIn);

const status = computed(() => {
    const e = props.entity;
    const embeddedIn = e.properties?.embeddedIn;
    if (embeddedIn) {
        return device.value?.status?.[embeddedIn]?.temperature ?? null;
    }
    return device.value?.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

// Native temperature reports tC; BLU reports it as the sensor's own value.
const temp = computed<number | null>(() => {
    const v = isBThome.value ? status.value?.value : status.value?.tC;
    return typeof v === 'number' ? v : null;
});

// Internal (PCB) temperature reads as a chip, not a room sensor.
const icon = computed(() =>
    isInternalTemp.value ? 'fas fa-microchip' : 'fas fa-temperature-half'
);
const tempText = computed(() =>
    temp.value !== null ? temp.value.toFixed(1) : '—'
);

// Only what the device actually reports — no empty cells.
const stats = computed(() => {
    const out: {label: string; value: string}[] = [];
    const battery = deviceBatteryPercent(device.value, getEntity);
    if (battery !== null) out.push({label: 'Battery', value: `${battery}%`});
    const seen = deviceLastSeen(device.value);
    if (seen) out.push({label: 'Last seen', value: seen});
    return out;
});
</script>

<style scoped>
.temp-body {
    display: flex;
    flex: 1;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
}
.temp-hero {
    display: flex;
    flex: 1;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    text-align: center;
}
.temp-readout {
    font-size: var(--type-display);
    font-weight: var(--font-black);
    line-height: 1;
    letter-spacing: var(--tracking-tight);
    background: var(--gradient-value-text);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.temp-unit {
    margin-left: 2px;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    -webkit-text-fill-color: var(--color-text-secondary);
}
.temp-stats {
    display: flex;
    gap: var(--space-5);
}
.temp-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
}
.temp-stat-v {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.temp-stat-l {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
