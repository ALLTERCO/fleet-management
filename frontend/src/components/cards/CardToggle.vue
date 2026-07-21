<template>
    <div
        class="ec-switch"
        :class="[
            size !== 'md' ? `ec-switch--${size}` : null,
            {on: state, off: !state && !disabled}
        ]"
        :disabled="disabled || undefined"
        role="switch"
        :aria-checked="state ? 'true' : 'false'"
        :tabindex="disabled ? -1 : 0"
        @click.stop="onActivate"
        @keydown.enter.stop="onKeyActivate"
        @keydown.space.prevent.stop="onKeyActivate"
    >
        <div class="ec-switch-thumb" />
        <div class="ec-switch-label">{{ label ?? (state ? 'ON' : 'OFF') }}</div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

// Two call styles share this one control: cards drive it with isOn/@toggle,
// forms bind v-model. Exactly one of isOn / modelValue should be set.
const props = withDefaults(
    defineProps<{
        isOn?: boolean;
        modelValue?: boolean;
        disabled?: boolean;
        label?: string;
        size?: 'md' | 'sm' | 'row';
    }>(),
    {
        isOn: undefined,
        modelValue: undefined,
        disabled: false,
        label: undefined,
        size: 'md'
    }
);

const emit = defineEmits<{
    toggle: [];
    'update:modelValue': [boolean];
}>();

const state = computed(() => props.isOn ?? props.modelValue ?? false);

function onActivate() {
    if (props.disabled) return;
    emit('toggle');
    emit('update:modelValue', !state.value);
}

function onKeyActivate(event: KeyboardEvent) {
    if (event.repeat) return;
    onActivate();
}
</script>
