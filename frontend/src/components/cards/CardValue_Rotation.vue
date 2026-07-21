<template>
    <CardShell
        type="rotation"
        :name="entity.name"
        icon="fas fa-rotate"
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
            <div class="rot-body">
                <svg class="rot-dial" width="66" height="66" viewBox="0 0 60 60" role="img" :aria-label="`Rotation ${degText}°`">
                    <circle cx="30" cy="30" r="24" fill="none" stroke="var(--color-border-medium)" stroke-width="3" />
                    <line
                        class="rot-needle"
                        x1="30" y1="30" x2="30" y2="9"
                        stroke="var(--color-sensor-rotation)"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        :style="{ transform: `rotate(${degrees}deg)` }"
                    />
                    <circle cx="30" cy="30" r="2.5" fill="var(--color-sensor-rotation)" />
                </svg>
                <div class="rot-value">{{ degText }}<span>°</span></div>
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

const degrees = computed<number>(() => {
    const v = status.value?.value;
    return typeof v === 'number' ? v : 0;
});
const degText = computed(() => String(Math.round(degrees.value)));
</script>

<style scoped>
.rot-body {
    display: flex;
    flex: 1;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    text-align: center;
}
.rot-dial {
    display: block;
    width: 66px;
    height: 66px;
    margin: 0 auto;
}
/* Needle points up at 0° and rotates to the reported angle around the dial
   centre, animating as the value changes. */
.rot-needle {
    transform-box: view-box;
    transform-origin: 30px 30px;
    transition: transform var(--duration-normal) ease;
}
.rot-value {
    font-size: var(--type-heading);
    font-weight: var(--font-black);
    letter-spacing: var(--tracking-tight);
    line-height: 1;
    color: var(--color-sensor-rotation);
}
.rot-value span {
    margin-left: 1px;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    vertical-align: top;
}
</style>
