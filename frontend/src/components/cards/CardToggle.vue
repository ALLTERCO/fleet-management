<template>
    <div
        class="ec-switch"
        :class="{on: isOn, off: !isOn && !disabled}"
        :disabled="disabled || undefined"
        role="switch"
        :aria-checked="isOn"
        :tabindex="disabled ? -1 : 0"
        @click.stop="onActivate"
        @keydown.enter.stop="onActivate"
        @keydown.space.prevent.stop="onActivate"
    >
        <div class="ec-switch-thumb" />
        <div class="ec-switch-label">{{ label ?? (isOn ? 'ON' : 'OFF') }}</div>
    </div>
</template>

<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        isOn: boolean;
        disabled?: boolean;
        label?: string;
    }>(),
    {
        disabled: false
    }
);

const emit = defineEmits<{
    toggle: [];
}>();

function onActivate() {
    if (props.disabled) return;
    emit('toggle');
}
</script>
