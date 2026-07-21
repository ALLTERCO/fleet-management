<template>
    <CardShell
        type="illuminance"
        :name="entity.name"
        icon="fas fa-brightness"
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
            <div class="lux-body">
                <span class="lux-value" :class="sizeClass">{{ luxText }}</span>
                <span class="lux-unit">lux</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
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

// Native illuminance:N reports lux; BLU reports it as the sensor's own value.
const lux = computed<number | null>(() => {
    const v = status.value?.lux ?? status.value?.illuminance ?? status.value?.value;
    return typeof v === 'number' ? Math.round(v) : null;
});
const luxText = computed(() =>
    lux.value !== null ? String(lux.value) : '—'
);

// Lux spans a huge range (0 – 100000+); keep the number big, only stepping it
// down once it gets long enough to overflow the tile.
const sizeClass = computed(() => {
    const digits = luxText.value.replace('—', '').length;
    return digits >= 5 ? 'lux-value--sm' : 'lux-value--lg';
});
</script>

<style scoped>
.lux-body {
    display: flex;
    flex: 1;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    text-align: center;
}
.lux-value {
    font-weight: var(--font-black);
    line-height: 1;
    letter-spacing: var(--tracking-tight);
    background: var(--gradient-value-text);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.lux-value--lg {
    font-size: var(--type-display);
}
.lux-value--sm {
    font-size: var(--type-heading);
}
.lux-unit {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
</style>
