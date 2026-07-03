<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label">Max items</label>
        <input
            v-model.number="cfg.maxItems"
            class="chart-cfg-select"
            type="number"
            placeholder="20"
        />
    </div>
</template>

<script setup lang="ts">
import type {MaintCfg} from '@/helpers/widgetBuilders';

defineProps<{cfg: MaintCfg}>();
</script>
