<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label">Entity IDs (comma-separated)</label>
        <input
            v-model="cfg.entityIdsRaw"
            class="chart-cfg-select"
            placeholder="pm1:0, switch:0"
        />
        <label class="chart-cfg-label">Max items</label>
        <input
            v-model.number="cfg.limit"
            class="chart-cfg-select"
            type="number"
            placeholder="10"
        />
    </div>
</template>

<script setup lang="ts">
import type {TopCfg} from '@/helpers/widgetBuilders';

defineProps<{cfg: TopCfg}>();
</script>
