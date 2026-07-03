<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label">Device</label>
        <select v-model="cfg.shellyId" class="chart-cfg-select">
            <option value="">Select device...</option>
            <option
                v-for="d in chartDeviceList"
                :key="d.shellyID"
                :value="d.shellyID"
            >
                {{ getDeviceName(d.info, d.shellyID) }}
            </option>
        </select>
        <label class="chart-cfg-label">Metric</label>
        <select v-model="cfg.metric" class="chart-cfg-select">
            <option value="temperature">Temperature</option>
            <option value="humidity">Humidity</option>
            <option value="power">Power</option>
            <option value="consumption">Energy (consumption)</option>
        </select>
    </div>
</template>

<script setup lang="ts">
import {getDeviceName} from '@/helpers/device';
import type {HeatmapCfg} from '@/helpers/widgetBuilders';
import type {shelly_device_t} from '@/types';

defineProps<{cfg: HeatmapCfg; chartDeviceList: shelly_device_t[]}>();
</script>
