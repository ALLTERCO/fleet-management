<template>
    <div class="card ctr">
        <div class="lab">{{ label }}</div>
        <div class="kpi">
            <span>{{ formatted }}</span><small v-if="unit">{{ unit }}</small>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: number | null;
        unit?: string;
        decimals?: number;
    }>(),
    {decimals: 1}
);

// Styling comes from the shared voltaine .evolt system (this renders inside it).
const formatted = computed(() =>
    props.value == null ? '—' : props.value.toFixed(props.decimals)
);
</script>
