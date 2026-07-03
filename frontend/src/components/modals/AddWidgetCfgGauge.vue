<template>
    <div class="chart-cfg">
        <label class="chart-cfg-label">Entity ID</label>
        <input
            v-model="cfg.entityId"
            class="chart-cfg-select"
            placeholder="e.g. pm1:0"
        />
        <label class="chart-cfg-label">Field</label>
        <input
            v-model="cfg.field"
            class="chart-cfg-select"
            placeholder="e.g. apower"
        />
        <label class="chart-cfg-label">Label</label>
        <input
            v-model="cfg.label"
            class="chart-cfg-select"
            placeholder="Power"
        />
        <label class="chart-cfg-label">Unit</label>
        <input
            v-model="cfg.unit"
            class="chart-cfg-select"
            placeholder="W"
        />
        <label class="chart-cfg-label">Min / Max</label>
        <div class="awm-cfg-row">
            <input
                v-model.number="cfg.min"
                class="chart-cfg-select awm-cfg-row__input"
                type="number"
                placeholder="0"
            />
            <input
                v-model.number="cfg.max"
                class="chart-cfg-select awm-cfg-row__input"
                type="number"
                placeholder="3500"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import type {GaugeCfg} from '@/helpers/widgetBuilders';

defineProps<{cfg: GaugeCfg}>();
</script>
