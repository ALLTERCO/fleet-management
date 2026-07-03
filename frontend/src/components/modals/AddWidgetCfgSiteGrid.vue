<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label">Metric</label>
        <select v-model="cfg.metric" class="chart-cfg-select">
            <option value="power">Live Power</option>
            <option value="devices">Device Count</option>
            <option value="alerts">Alert Count</option>
        </select>
    </div>
</template>

<script setup lang="ts">
import type {SiteGridCfg} from '@/helpers/widgetBuilders';

defineProps<{cfg: SiteGridCfg}>();
</script>
