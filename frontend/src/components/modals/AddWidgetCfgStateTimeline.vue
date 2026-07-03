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
        <label class="chart-cfg-label">Field</label>
        <input
            v-model="cfg.field"
            class="chart-cfg-select"
            placeholder="e.g. switch:0.output"
        />
        <label class="chart-cfg-label">Label</label>
        <input
            v-model="cfg.name"
            class="chart-cfg-select"
            placeholder="Switch"
        />
    </div>
</template>

<script setup lang="ts">
import {getDeviceName} from '@/helpers/device';
import type {TimelineCfg} from '@/helpers/widgetBuilders';
import type {shelly_device_t} from '@/types';

defineProps<{cfg: TimelineCfg; chartDeviceList: shelly_device_t[]}>();
</script>
