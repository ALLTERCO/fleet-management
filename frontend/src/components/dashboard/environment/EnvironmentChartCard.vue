<template>
    <div class="card pad0">
        <div class="head" style="padding: 15px 20px 0">
            <h3>{{ block.label }}</h3>
            <span class="meta">
                avg {{ fmt(block.avg) }}{{ block.unit }}
                <template v-if="block.min != null">
                    · {{ fmt(block.min) }}–{{ fmt(block.max) }}
                </template>
            </span>
        </div>
        <div style="padding: 6px 12px 12px">
            <DashTimeChart
                :data="block.series"
                type="area"
                :color="color"
                :unit="block.unit"
                :height="180"
                :mark-area="markArea"
                :loading="loading"
                zoom
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import type {EnvKindBlock} from './environmentDashboard.types';

defineProps<{
    block: EnvKindBlock;
    color: string;
    markArea?: {min: number; max: number};
    loading?: boolean;
}>();

function fmt(v: number | null): string {
    return v == null ? '—' : v.toFixed(1);
}
</script>
