<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label">Metric</label>
        <select v-model="cfg.metric" class="chart-cfg-select">
            <option value="live_power">Live Power</option>
            <option value="energy_24h">Energy — last 24 h</option>
            <option value="energy_7d">Energy — last 7 d</option>
            <option value="energy_30d">Energy — last 30 d</option>
        </select>
        <label class="chart-cfg-label">Max sites shown</label>
        <input
            v-model.number="cfg.limit"
            class="chart-cfg-select"
            type="number"
            placeholder="10"
        />
    </div>
</template>

<script setup lang="ts">
import type {CrossBarCfg} from '@/helpers/widgetBuilders';

defineProps<{cfg: CrossBarCfg}>();
</script>
