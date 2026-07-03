<template>
    <div class="dash-dn-split">
        <div v-if="loading" class="dns-skeleton" />
        <template v-else>
            <div class="dns-row">
                <i class="fas fa-sun dns-icon dns-icon--day" />
                <div class="dns-info">
                    <div class="dns-head">
                        <span class="dns-label">Day</span>
                        <span class="dns-hours">{{ dayLabel }}</span>
                    </div>
                    <div class="dns-value">{{ formatNum(dayKwh) }} <span class="dns-unit">kWh</span></div>
                    <div class="dns-bar"><div class="dns-fill dns-fill--day" :style="{width: dayPct + '%'}" /></div>
                </div>
            </div>
            <div class="dns-row">
                <i class="fas fa-moon dns-icon dns-icon--night" />
                <div class="dns-info">
                    <div class="dns-head">
                        <span class="dns-label">Night</span>
                        <span class="dns-hours">{{ nightLabel }}</span>
                    </div>
                    <div class="dns-value">{{ formatNum(nightKwh) }} <span class="dns-unit">kWh</span></div>
                    <div class="dns-bar"><div class="dns-fill dns-fill--night" :style="{width: nightPct + '%'}" /></div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    dayKwh: number;
    nightKwh: number;
    dayStart?: string;
    dayEnd?: string;
    loading?: boolean;
}>();

const dayLabel = computed(() => {
    const s = props.dayStart?.slice(0, 5) ?? '07:00';
    const e = props.dayEnd?.slice(0, 5) ?? '23:00';
    return `${s}\u2013${e}`;
});
const nightLabel = computed(() => {
    const s = props.dayEnd?.slice(0, 5) ?? '23:00';
    const e = props.dayStart?.slice(0, 5) ?? '07:00';
    return `${s}\u2013${e}`;
});

const maxKwh = computed(() => Math.max(props.dayKwh, props.nightKwh, 1));
const dayPct = computed(() => (props.dayKwh / maxKwh.value) * 100);
const nightPct = computed(() => (props.nightKwh / maxKwh.value) * 100);

function formatNum(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 1});
}
</script>

<style scoped>
.dns-skeleton { height: 80px; background: var(--color-surface-3); border-radius: var(--radius-sm); animation: dns-pulse 1.5s ease infinite; }
@keyframes dns-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.dns-row { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2) 0; }
.dns-row + .dns-row { border-top: 1px solid var(--color-border-subtle); }
.dns-icon { font-size: var(--type-body); width: var(--icon-size-sm); text-align: center; margin-top: var(--space-0-5); }
.dns-icon--day { color: rgba(var(--color-warning-rgb), 0.6); }
.dns-icon--night { color: rgba(var(--color-primary-rgb), 0.5); }
.dns-info { flex: 1; }
.dns-head { display: flex; align-items: baseline; gap: var(--space-1-5); margin-bottom: var(--space-0-5); }
.dns-label { font-size: var(--type-body); font-weight: 500; color: var(--color-text-secondary); }
.dns-hours { font-size: var(--type-body); color: var(--color-text-tertiary); }
.dns-value { font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.dns-unit { font-size: var(--type-body); font-weight: 400; color: var(--color-text-tertiary); }
.dns-bar { height: 4px; background: var(--color-surface-3); border-radius: var(--radius-xs); overflow: hidden; margin-top: var(--space-1); }
.dns-fill { height: 100%; border-radius: var(--radius-xs); transition: width 0.8s ease; }
.dns-fill--day { background: var(--color-warning-text); opacity: 0.35; }
.dns-fill--night { background: var(--color-primary); opacity: 0.35; }
</style>
