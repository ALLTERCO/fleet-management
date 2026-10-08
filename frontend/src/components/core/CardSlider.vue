<template>
    <div class="ec-clr-track">
        <input
            type="range"
            class="sld-r"
            :class="`sld-${variant}`"
            :min="min"
            :max="max"
            :step="step"
            :value="value"
            :disabled="disabled"
            :aria-label="ariaLabel"
            @input="emit('input', $event)"
            @change="emit('change', $event)"
            @click.stop
        />
    </div>
</template>

<script setup lang="ts">
export type CardSliderVariant =
    | 'bri'
    | 'white'
    | 'cct'
    | 'temp'
    | 'hum'
    | 'hue'
    | 'cover'
    | 'tilt'
    | 'cury'
    | 'value';

withDefaults(
    defineProps<{
        value: number;
        variant: CardSliderVariant;
        min?: number | string;
        max?: number | string;
        step?: number | string;
        disabled?: boolean;
        ariaLabel?: string;
    }>(),
    {
        min: 0,
        max: 100,
        step: 1,
        disabled: false,
        ariaLabel: undefined
    }
);

const emit = defineEmits<{
    input: [event: Event];
    change: [event: Event];
}>();
</script>
