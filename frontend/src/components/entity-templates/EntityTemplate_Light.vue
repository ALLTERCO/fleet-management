<template>
    <div class="et-light">
        <div class="et-light__header">
            <span class="et-light__state" :class="isOn ? 'et-light__state--on' : 'et-light__state--off'">
                {{ isOn ? 'ON' : 'OFF' }}
            </span>
            <button
                v-if="canExecute"
                class="et-light__toggle"
                :class="isOn && 'et-light__toggle--on'"
                @click="emit('toggle')"
            >
                <i class="fas fa-power-off" />
            </button>
        </div>

        <!-- Color wheel (if entity has rgb in status) -->
        <ColorWheel
            v-if="hasRgb && isOn"
            :rgb="status?.rgb ?? [255, 255, 255]"
            @change="(rgb: [number, number, number]) => emit('setRgb', rgb)"
        />

        <!-- White channel (rgbw only) -->
        <HorizontalSlider
            v-if="hasWhite && isOn"
            :value="status?.white ?? 0"
            @change="(v: number) => emit('setWhite', v)"
        >
            <template #title> White ({{ status?.white ?? 0 }}) </template>
        </HorizontalSlider>

        <!-- Brightness slider (if entity has brightness in status) -->
        <HorizontalSlider
            v-if="hasBrightness && isOn"
            :value="status?.brightness ?? 0"
            :saved="{ '0%': 0, '25%': 25, '50%': 50, '75%': 75, '100%': 100 }"
            @change="(v: number) => emit('setBrightness', v)"
        >
            <template #title> Brightness ({{ status?.brightness ?? 0 }}%) </template>
        </HorizontalSlider>

        <!-- Color temperature slider (if entity has temp in status) -->
        <HorizontalSlider
            v-if="hasTemp && isOn"
            :value="status?.temp ?? 4000"
            :min="tempRange.min"
            :max="tempRange.max"
            :saved="tempPresets"
            @change="(v: number) => emit('setTemp', v)"
        >
            <template #title> Color Temp ({{ status?.temp ?? 4000 }}K) </template>
        </HorizontalSlider>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import ColorWheel from '@/components/core/ColorWheel.vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
}>();

const emit = defineEmits<{
    toggle: [];
    setRgb: [[number, number, number]];
    setWhite: [number];
    setBrightness: [number];
    setTemp: [number];
}>();

const isOn = computed(() => !!props.status?.output);

// Capability detection from status keys
const hasRgb = computed(() => props.status?.rgb !== undefined);
const hasWhite = computed(() => props.status?.white !== undefined);
const hasBrightness = computed(() => props.status?.brightness !== undefined);
const hasTemp = computed(() => props.status?.temp !== undefined);

// Color temp range from settings, with sane defaults
const tempRange = computed(() => ({
    min: props.settings?.min_temp_k ?? 2700,
    max: props.settings?.max_temp_k ?? 6500
}));

const tempPresets = computed(() => {
    const {min, max} = tempRange.value;
    return {Warm: min, '3500K': 3500, '4500K': 4500, Cool: max};
});
</script>

<style scoped>
.et-light {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.et-light__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.et-light__state {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-wide);
}
.et-light__state--on {
    color: var(--color-success-text);
}
.et-light__state--off {
    color: var(--color-text-disabled);
}
.et-light__toggle {
    width: 40px;
    height: 40px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-base);
    cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-light__toggle:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-light__toggle--on {
    background-color: var(--color-success);
    border-color: var(--color-success);
    color: white;
}
</style>
