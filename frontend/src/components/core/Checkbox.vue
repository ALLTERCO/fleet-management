<template>
    <div class="flex items-center mb-4">
        <input
            :id="id"
            v-model="selected"
            type="checkbox"
            class="core-checkbox w-4 h-4 rounded focus:ring-2"
            @click="onClick"
        />
        <label :for="id" class="core-checkbox-label ml-2 text-sm font-medium"><slot /></label>
    </div>
</template>

<script setup lang="ts">
import {ref, useId, watch} from 'vue';

const emit = defineEmits<{
    click: [];
    'update:modelValue': [selected: boolean];
}>();

const props = withDefaults(
    defineProps<{
        modelValue?: boolean;
    }>(),
    {modelValue: false}
);

const id = useId();

const selected = ref(props.modelValue);

watch(
    () => props.modelValue,
    (newValue) => {
        selected.value = newValue;
    }
);

function onClick() {
    selected.value = !selected.value;
    emit('click');
    emit('update:modelValue', selected.value);
}
</script>

<style scoped>
.core-checkbox {
    accent-color: var(--color-primary);
    background-color: var(--color-surface-3);
    border-color: var(--color-border-strong);
    /* Ensure minimum 44x44 touch target via padding around the visual checkbox */
    position: relative;
    cursor: pointer;
}
.core-checkbox::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 44px;
    min-height: 44px;
}
.core-checkbox:focus {
    box-shadow: 0 0 0 2px var(--color-border-focus);
}
.core-checkbox-label {
    color: var(--color-text-secondary);
}
</style>
