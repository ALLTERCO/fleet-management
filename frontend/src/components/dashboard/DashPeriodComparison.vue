<template>
    <div class="dash-period-cmp-wrap">
        <div v-if="loading" class="cmp-skeleton" />
        <template v-else>
            <div class="dash-period-cmp">
                <div class="cmp-side">
                    <div class="cmp-label">This period</div>
                    <div class="cmp-value">{{ formatNum(current) }} <span class="cmp-unit">{{ unit }}</span></div>
                    <div class="cmp-bar"><div class="cmp-fill cmp-fill--current" :style="{width: currentPct + '%'}" /></div>
                </div>
                <div class="cmp-side">
                    <div class="cmp-label">Previous</div>
                    <div class="cmp-value">{{ formatNum(previous) }} <span class="cmp-unit">{{ unit }}</span></div>
                    <div class="cmp-bar"><div class="cmp-fill cmp-fill--prev" :style="{width: prevPct + '%'}" /></div>
                </div>
            </div>
            <div v-if="delta !== null && delta !== 0" class="cmp-delta" :class="deltaClass">
                <i :class="delta > 0 ? 'fas fa-arrow-up' : 'fas fa-arrow-down'" class="cmp-delta-icon" />
                {{ Math.abs(delta) }}%
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        current: number;
        previous: number;
        unit: string;
        invertDelta?: boolean;
        loading?: boolean;
    }>(),
    {invertDelta: false}
);

const maxVal = computed(() => Math.max(props.current, props.previous, 1));
const currentPct = computed(() => (props.current / maxVal.value) * 100);
const prevPct = computed(() => (props.previous / maxVal.value) * 100);

const delta = computed(() => {
    if (!props.previous || props.previous === 0) return null;
    return Math.round(
        ((props.current - props.previous) / props.previous) * 100
    );
});

const deltaClass = computed(() => {
    if (delta.value === null) return '';
    const isUp = delta.value > 0;
    const isBad = props.invertDelta ? !isUp : isUp;
    return isBad ? 'cmp-delta--bad' : 'cmp-delta--good';
});

function formatNum(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 1});
}
</script>

<style scoped>
.dash-period-cmp-wrap {
    position: relative;
    animation: cmp-appear 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes cmp-appear {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}
.cmp-skeleton { height: 80px; background: var(--color-surface-3); border-radius: var(--radius-sm); animation: cmp-pulse 1.5s ease infinite; }
@keyframes cmp-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.dash-period-cmp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.cmp-side { flex: 1; }
.cmp-label { font-size: var(--type-body); color: var(--color-text-secondary); margin-bottom: 3px; }
.cmp-value { font-size: var(--type-subheading); font-weight: 600; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.cmp-unit { font-size: var(--type-body); font-weight: 400; color: var(--color-text-tertiary); }
.cmp-bar { height: 4px; background: var(--color-surface-3); border-radius: var(--radius-xs); overflow: hidden; margin-top: var(--space-1); }
.cmp-fill { height: 100%; border-radius: var(--radius-xs); transition: width 1s cubic-bezier(0.16, 1, 0.3, 1); }
.cmp-fill--current { background: var(--color-primary); opacity: 0.5; }
.cmp-fill--prev { background: var(--color-border-medium); }
.cmp-delta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
    font-size: var(--type-body);
    font-weight: 600;
    padding: 3px var(--space-2);
    border-radius: var(--radius-sm);
    width: fit-content;
    animation: delta-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.6s both;
}
@keyframes delta-pop {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
}
.cmp-delta--bad { color: var(--color-danger-text); background: rgba(var(--color-danger-rgb), 0.08); }
.cmp-delta--good { color: var(--color-success-text); background: rgba(var(--color-success-rgb), 0.08); }
.cmp-delta-icon { font-size: var(--type-caption); }
</style>
