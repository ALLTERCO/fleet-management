<template>
    <div class="slider-container rounded-lg shadow-lg py-2 px-3 w-full">
        <div :class="`mb-1 text-base font-medium ${disabled ? 'slider-disabled' : ''}`">
            <slot name="title" />
        </div>
        <input
            :value="value"
            :min="min"
            :max="max"
            :disabled="disabled"
            type="range"
            class="w-full"
            @change="onChange"
        />
        <div v-if="saved" class="flex flex-row justify-between">
            <Button
                v-for="(savedValue, savedTitle) of saved"
                :key="savedValue"
                narrow
                class="!w-auto"
                @click="emit('change', savedValue)"
            >
                {{ savedTitle }}
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {toRefs} from 'vue';
import Button from './Button.vue';

const props = withDefaults(
    defineProps<{
        value: number;
        min?: number;
        max?: number;
        saved?: Record<string, number> | null;
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
const emit = defineEmits<{
    change: [value: number];
}>();

const {value, min, max, saved, disabled} = toRefs(props);

function onChange(event: Event) {
    if (disabled.value) {
        return;
    }

    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    emit('change', value);
}
</script>

<style scoped>
.slider-container {
    background-color: var(--color-surface-2);
}
.slider-disabled {
    color: var(--color-text-tertiary);
}
</style>
