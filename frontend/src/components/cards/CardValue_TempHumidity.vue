<template>
    <!-- 1x1 / 2x1 — temperature | humidity side by side -->
    <CardShell
        v-if="size !== '2x2'"
        type="temperature"
        :name="entity.name"
        icon="fas fa-temperature-half"
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
            <div class="th-dual">
                <div class="th-item">
                    <div class="th-value">{{ tempText }}<span class="th-unit">°C</span></div>
                    <div class="th-label">Temp</div>
                </div>
                <div class="th-sep" />
                <div class="th-item">
                    <div class="th-value">{{ humidityText }}<span class="th-unit">%</span></div>
                    <div class="th-label">Humidity</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2x2 — temp hero + humidity + health stats -->
    <CardShell
        v-else
        type="temperature"
        :name="entity.name"
        icon="fas fa-temperature-half"
        size="2x2"
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
            <div class="th-hero">
                <div class="th-value th-value--hero">{{ tempText }}<span class="th-unit">°C</span></div>
                <div class="th-humidity">{{ humidityText }}% RH</div>
                <div v-if="stats.length" class="th-stats">
                    <div v-for="s in stats" :key="s.label" class="th-stat">
                        <div class="th-stat-v">{{ s.value }}</div>
                        <div class="th-stat-l">{{ s.label }}</div>
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

const status = computed(() => {
    const e = props.entity;
    return device.value?.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

const temp = computed<number | null>(() => {
    const v = status.value?.tC;
    return typeof v === 'number' ? v : null;
});
const tempText = computed(() =>
    temp.value !== null ? temp.value.toFixed(1) : '—'
);

// This card is only used when the device reports humidity on humidity:0.
const humidity = computed<number | null>(() => {
    const rh = device.value?.status?.['humidity:0']?.rh;
    return typeof rh === 'number' ? rh : null;
});
const humidityText = computed(() =>
    humidity.value !== null ? String(Math.round(humidity.value)) : '—'
);

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
.th-dual {
    display: flex;
    flex: 1;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
}
.th-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
}
.th-sep {
    width: 1px;
    align-self: stretch;
    margin: var(--space-3) 0;
    background: var(--color-border-default);
}
.th-value {
    font-size: var(--type-subheading);
    font-weight: var(--font-black);
    line-height: 1;
    letter-spacing: var(--tracking-tight);
    background: var(--gradient-value-text);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.th-value--hero {
    font-size: var(--type-display);
}
.th-unit {
    margin-left: 2px;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    -webkit-text-fill-color: var(--color-text-secondary);
}
.th-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.th-hero {
    display: flex;
    flex: 1;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-align: center;
}
.th-humidity {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.th-stats {
    display: flex;
    gap: var(--space-5);
    margin-top: var(--space-2);
}
.th-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
}
.th-stat-v {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.th-stat-l {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
