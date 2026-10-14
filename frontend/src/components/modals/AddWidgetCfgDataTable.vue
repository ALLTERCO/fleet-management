<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label" for="device-health-sort">Initial sort</label>
        <select
            id="device-health-sort"
            v-model="cfg.sortBy"
            class="chart-cfg-select"
        >
            <option value="name">Name</option>
            <option value="online">Status</option>
            <option value="signal">Signal</option>
            <option value="battery">Battery</option>
            <option value="firmware">Firmware</option>
        </select>

        <label class="chart-cfg-label" for="device-health-max-rows">Max rows</label>
        <input
            id="device-health-max-rows"
            v-model.number="cfg.maxRows"
            class="chart-cfg-select"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
        />
    </div>
</template>

<script setup lang="ts">
import type {DataTableCfg} from '@/helpers/widgetBuilders';

defineProps<{cfg: DataTableCfg}>();
</script>
