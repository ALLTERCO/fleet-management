<template>
    <div class="slider-container rounded-lg shadow-lg py-2 px-3 w-full">
        <div :class="`mb-1 text-base font-medium ${disabled ? 'slider-disabled' : ''}`">
            <slot name="title" />
        </div>

        <div class="progress-track relative w-full h-2 rounded-full">
            <div class="progress-fill h-full rounded-full transition-all" :style="{ width: progressWidth }"></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, toRefs} from 'vue';

const props = withDefaults(
    defineProps<{
        value: number;
        min?: number;
        max?: number;
        disabled?: boolean;
    }>(),
    {
        value: 0,
        min: 0,
        max: 100,
        saved: null,
        disabled: false
    }
);

const {value, min, max, disabled} = toRefs(props);

const progressWidth = computed(() => {
    const percentage =
        ((value.value - min.value) / (max.value - min.value)) * 100;
    return `${percentage}%`;
});
</script>

<style scoped>
.slider-container {
    background-color: var(--color-surface-2);
}
.slider-disabled {
    color: var(--color-text-tertiary);
}
.progress-track {
    background-color: var(--color-surface-3);
}
.progress-fill {
    background-color: var(--color-primary);
}
</style>
