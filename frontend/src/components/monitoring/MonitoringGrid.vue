<template>
    <div class="monitoring-grid" :class="gridClass">
        <slot />
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        columns?: 2 | 3 | 4 | 5;
    }>(),
    {
        columns: 4
    }
);

const gridClass = computed(() => `monitoring-grid--${props.columns}`);
</script>

<style scoped>
.monitoring-grid {
    display: grid;
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: var(--gap-sm);
}
@media (min-width: 700px) {
    .monitoring-grid--2,
    .monitoring-grid--3,
    .monitoring-grid--4,
    .monitoring-grid--5 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (min-width: 1100px) {
    .monitoring-grid--3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .monitoring-grid--4 {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .monitoring-grid--5 {
        grid-template-columns: repeat(5, minmax(0, 1fr));
    }
}
</style>
