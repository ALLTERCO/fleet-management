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
            <option value="power">Power (W)</option>
            <option value="consumption">Energy (Wh)</option>
            <option value="voltage">Voltage (V)</option>
            <option value="current">Current (A)</option>
            <option value="temperature">Temperature (°C)</option>
            <option value="humidity">Humidity (%)</option>
            <option value="luminance">Luminance (lux)</option>
        </select>
        <label class="chart-cfg-label">Chart type</label>
        <select v-model="cfg.chartType" class="chart-cfg-select">
            <option value="bar">Bar</option>
            <option value="line">Line</option>
        </select>
    </div>
</template>

<script setup lang="ts">
import {getDeviceName} from '@/helpers/device';
import type {ChartCfg} from '@/helpers/widgetBuilders';
import type {shelly_device_t} from '@/types';

defineProps<{
    cfg: ChartCfg;
    chartDeviceList: shelly_device_t[];
}>();
</script>
