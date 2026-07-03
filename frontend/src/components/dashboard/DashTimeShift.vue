<template>
    <div class="dts">
        <div v-if="loading" class="dts__skeleton" />
        <template v-else-if="error">
            <div class="dts__empty">{{ error }}</div>
        </template>
        <template v-else-if="!plan">
            <div class="dts__empty">No load-shift opportunity for this period.</div>
        </template>
        <template v-else>
            <div class="dts__headline">
                Shift <strong>{{ formatKwh(plan.shiftedKWh) }} kWh</strong>
                from <span class="dts__hour">{{ pad(plan.fromHour) }}:00</span>
                → <span class="dts__hour dts__hour--good">{{ pad(plan.toHour) }}:00</span>
            </div>
            <div class="dts__row">
                <span class="dts__label">Avoidable CO₂</span>
                <span class="dts__value">{{ formatKg(plan.avoidedKgCO2) }} kg</span>
            </div>
            <div class="dts__row">
                <span class="dts__label">Worst hour intensity</span>
                <span class="dts__value">{{ Math.round(plan.worstGPerKWh) }} g/kWh</span>
            </div>
            <div class="dts__row">
                <span class="dts__label">Best hour intensity</span>
                <span class="dts__value">{{ Math.round(plan.bestGPerKWh) }} g/kWh</span>
            </div>
            <div class="dts__hint">
                Source: {{ providerLabel }}.
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    dashboardId?: number;
    devices?: string[];
    from: string;
    to: string;
    maxShiftableKWh?: number;
    providerLabel?: string;
}>();

interface TimeShiftPlan {
    fromHour: number;
    toHour: number;
    shiftedKWh: number;
    avoidedKgCO2: number;
    worstGPerKWh: number;
    bestGPerKWh: number;
}
interface TimeShiftResponse {
    plan: TimeShiftPlan | null;
}

const loading = ref(false);
const error = ref<string | null>(null);
const plan = ref<TimeShiftPlan | null>(null);
const providerLabel = computed(() => props.providerLabel ?? 'static LBM curve');

async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const res = await sendRPC<TimeShiftResponse>(
            'FLEET_MANAGER',
            'Report.SuggestTimeShift',
            {
                dashboardId: props.dashboardId,
                devices: props.devices,
                from: props.from,
                to: props.to,
                maxShiftableKWh: props.maxShiftableKWh
            }
        );
        plan.value = res.plan;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        error.value = `Could not compute time-shift: ${msg}`;
        plan.value = null;
    } finally {
        loading.value = false;
    }
}

onMounted(refresh);
watch(
    () => [props.dashboardId, props.devices, props.from, props.to, props.maxShiftableKWh],
    refresh,
    {deep: true}
);

function pad(n: number): string {
    return String(n).padStart(2, '0');
}
function formatKwh(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 2});
}
function formatKg(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 2});
}
</script>

<style scoped>
.dts__skeleton {
    height: 120px;
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    animation: dts-pulse 1.5s ease infinite;
}
@keyframes dts-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
.dts__empty {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    padding: var(--space-3) 0;
}
.dts__headline {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin-bottom: var(--space-2);
}
.dts__hour {
    color: var(--color-warning);
    font-variant-numeric: tabular-nums;
}
.dts__hour--good { color: var(--color-success); }
.dts__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-0-5) 0;
    font-size: var(--type-body);
}
.dts__label { color: var(--color-text-tertiary); }
.dts__value { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.dts__hint {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-top: var(--space-1);
}
</style>
