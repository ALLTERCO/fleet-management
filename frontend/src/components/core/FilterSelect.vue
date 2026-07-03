<template>
    <Dropdown
        :options="dropdownOptions"
        :default="effectiveDefault"
        @selected="onSelected"
    />
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Dropdown from './Dropdown.vue';

const props = withDefaults(
    defineProps<{
        modelValue: string;
        options: readonly string[];
        allLabel?: string;
    }>(),
    {allLabel: 'All'}
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

const dropdownOptions = computed(() => [props.allLabel, ...props.options]);
const effectiveDefault = computed(() =>
    props.modelValue ? props.modelValue : props.allLabel
);

function onSelected(label: string): void {
    emit('update:modelValue', label === props.allLabel ? '' : label);
}
</script>
