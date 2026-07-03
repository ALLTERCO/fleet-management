<template>
    <Pill :variant="variant">{{ label }}</Pill>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Pill from '@/components/core/Pill.vue';

const props = defineProps<{source: 'set' | 'inherited'}>();

const label = computed(() => (props.source === 'set' ? 'Set' : 'Inherited'));
const variant = computed<'primary' | 'neutral'>(() =>
    props.source === 'set' ? 'primary' : 'neutral'
);
</script>
