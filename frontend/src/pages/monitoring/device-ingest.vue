<template>
    <div class="space-y-4 p-2">
        <h2 class="sr-only">Device Ingest</h2>
        <!-- Tier gate -->
        <BasicBlock v-if="store.obsLevel === 0" darker class="text-center py-8">
            <p class="di-disabled-text">Enable monitoring to see device ingest metrics.</p>
            <button
                class="mt-3 px-4 py-2 text-sm font-mono rounded di-enable-btn transition-colors"
                @click="store.changeLevel(1)"
            >Enable Light Monitoring</button>
        </BasicBlock>

        <template v-if="store.obsLevel >= 1 && store.latest">
            <!-- Insight Panel -->
            <InsightPanel :insights="insights" />

            <!-- Device Fleet -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm di-block-title">Device Fleet</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard label="Devices Online" :value="store.latest.devicesTotal" :spark-data="cachedHistory.devicesTotal" color="#60a5fa" />
                        <StatCard
                            label="Connect Rate"
                            :value="fmtRate(store.counterRates.devices_connected)"
                            suffix="/min"
                        />
                        <StatCard
                            label="Disconnect Rate"
                            :value="fmtRate(store.counterRates.devices_disconnected)"
                            suffix="/min"
                            :warn="(store.counterRates.devices_disconnected ?? 0) > 10"
                        />
                        <StatCard label="Browser Sessions" :value="store.latest.wsClients" :spark-data="cachedHistory.wsClients" color="#a78bfa" />
                    </div>
                </div>
            </BasicBlock>

            <!-- Init Queue -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <HealthDot :status="store.deviceIngestStatus" />
                        <h3 class="font-semibold text-sm di-block-title">Initialization Queue</h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard label="Active Inits" :value="store.latest.initActive" :spark-data="cachedHistory.initActive" color="#fbbf24" :warn="store.latest.initActive > 50" :critical="store.latest.initActive > 100" />
                        <StatCard label="Queued" :value="store.latest.initQueued" />
                        <StatCard
                            label="Started/min"
                            :value="fmtRate(store.counterRates.device_inits_started)"
                        />
                        <StatCard
                            label="Failures/min"
                            :value="fmtRate(store.counterRates.device_inits_failed)"
                            :spark-data="cachedHistory.initFailureRate"
                            color="#f87171"
                            :warn="(store.counterRates.device_inits_failed ?? 0) > 2"
                            :critical="(store.counterRates.device_inits_failed ?? 0) > 10"
                        />
                    </div>
                </div>
            </BasicBlock>

            <!-- Time-series charts -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm di-block-title">Init Activity Over Time</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div class="text-xs di-chart-label mb-1">Active Inits (of 100 max)</div>
                            <TimeSeriesChart
                                :data="cachedHistory.initActive"
                                label="Active Inits"
                                color="#fbbf24"
                                :thresholds="[{value: 50, color: '#fbbf24', label: 'Warning'}, {value: 80, color: '#f87171', label: 'Critical'}]"
                                :height="160"
                            />
                        </div>
                        <div>
                            <div class="text-xs di-chart-label mb-1">Init Failures per Minute</div>
                            <TimeSeriesChart
                                :data="cachedHistory.initFailureRate"
                                label="Failures/min"
                                color="#f87171"
                                unit="/min"
                                :thresholds="[{value: 2, color: '#fbbf24', label: 'Warning'}, {value: 10, color: '#f87171', label: 'Critical'}]"
                                :height="160"
                            />
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Counters (Tier 2+) -->
            <BasicBlock v-if="store.obsLevel >= 2" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm di-block-title">Device Counters</h3>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                        <div v-for="key in deviceCounterKeys" :key="key" class="p-2 di-counter-card rounded text-xs font-mono">
                            <span class="di-counter-label">{{ key }}:</span>
                            <span class="di-counter-value ml-1">{{ store.latestMetrics?.counters?.[key] ?? 0 }}</span>
                            <span v-if="store.counterRates[key]" class="ml-1 di-counter-rate">
                                (+{{ store.counterRates[key] }}/min)
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Init Durations (Tier 2+) -->
            <BasicBlock v-if="store.obsLevel >= 2 && initDurations.length > 0" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm di-block-title">
                        Recent Init Durations
                        <span class="di-hint-text font-normal">(last {{ initDurations.length }})</span>
                    </h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                        <StatCard label="Avg Duration" :value="`${initDurationStats.avg}ms`" />
                        <StatCard label="Max Duration" :value="`${initDurationStats.max}ms`" :warn="initDurationStats.max > 5000" />
                        <StatCard label="Min Duration" :value="`${initDurationStats.min}ms`" />
                        <StatCard label="Samples" :value="initDurations.length" />
                    </div>
                    <div class="max-h-48 overflow-auto">
                        <div v-for="(entry, i) in initDurations" :key="i"
                            class="flex items-center gap-3 text-xs font-mono di-row-border py-1.5"
                        >
                            <span class="di-hint-text w-16 flex-shrink-0">{{ formatTime(entry.ts) }}</span>
                            <span class="di-id-text flex-shrink-0">{{ entry.shellyID }}</span>
                            <span class="text-right ml-auto font-semibold" :class="durationColor(entry.durationMs)">
                                {{ entry.durationMs }}ms
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Init Failures (Tier 2+) -->
            <BasicBlock v-if="store.obsLevel >= 2 && initFailures.length > 0" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm di-block-title">
                        Recent Init Failures
                        <span class="di-hint-text font-normal">(last {{ initFailures.length }})</span>
                    </h3>
                    <div class="max-h-64 overflow-auto">
                        <div
                            v-for="(entry, i) in initFailures"
                            :key="i"
                            class="flex items-center gap-3 text-xs font-mono di-row-border py-1.5"
                        >
                            <span class="di-hint-text w-16 flex-shrink-0">{{ formatTime(entry.ts) }}</span>
                            <span class="di-id-warning flex-shrink-0">{{ entry.shellyID }}</span>
                            <span class="di-error-text truncate">{{ entry.error }}</span>
                        </div>
                    </div>
                </div>
            </BasicBlock>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import type {Insight} from '@/components/monitoring/InsightPanel.vue';
import InsightPanel from '@/components/monitoring/InsightPanel.vue';
import StatCard from '@/components/monitoring/StatCard.vue';
import TimeSeriesChart from '@/components/monitoring/TimeSeriesChart.vue';
import {useMonitoringStore} from '@/stores/monitoring';

const store = useMonitoringStore();

// ── Cached history fields ────────────────────────────────────────
const cachedHistory = computed(() => ({
    devicesTotal: store.historyField('devicesTotal'),
    wsClients: store.historyField('wsClients'),
    initActive: store.historyField('initActive'),
    initFailureRate: store.historyField('initFailureRate')
}));

const deviceCounterKeys = [
    'devices_connected',
    'devices_disconnected',
    'device_inits_started',
    'device_inits_completed',
    'device_inits_failed'
];

const initFailures = computed(() => store.latestMetrics?.initFailures ?? []);

const initDurations = computed(() =>
    [...(store.latestMetrics?.initDurations ?? [])].reverse()
);
const initDurationStats = computed(() => {
    const durations = initDurations.value.map((e: any) => e.durationMs);
    if (durations.length === 0) return {avg: 0, max: 0, min: 0};
    return {
        avg: Math.round(
            durations.reduce((a: number, b: number) => a + b, 0) /
                durations.length
        ),
        max: Math.max(...durations),
        min: Math.min(...durations)
    };
});

function durationColor(ms: number): string {
    if (ms > 5000) return 'di-duration-critical';
    if (ms > 2000) return 'di-duration-warning';
    return 'di-duration-ok';
}

const insights = computed<Insight[]>(() => {
    const list: Insight[] = [];
    const s = store.latest;
    if (!s) return list;
    if (s.initActive > 80) {
        list.push({
            icon: 'fa-solid fa-triangle-exclamation',
            title: 'Init Queue Near Capacity',
            description: `${s.initActive}/100 concurrent init slots in use. ${s.initQueued} devices are queued waiting for a slot.`,
            action: 'Check network connectivity to devices. Consider staggering device reconnections.',
            severity: s.initActive >= 100 ? 'critical' : 'warning'
        });
    }
    if (s.initFailureRate > 2) {
        list.push({
            icon: 'fa-solid fa-xmark-circle',
            title: 'High Init Failure Rate',
            description: `${s.initFailureRate} device initialization failures per minute.`,
            action: 'Check recent init failures below. Common causes: firmware mismatch, network timeout, DB errors.',
            severity: s.initFailureRate > 10 ? 'critical' : 'warning'
        });
    }
    if ((store.counterRates.devices_disconnected ?? 0) > 20) {
        list.push({
            icon: 'fa-solid fa-plug-circle-xmark',
            title: 'High Disconnect Rate',
            description: `${store.counterRates.devices_disconnected}/min devices disconnecting.`,
            action: 'Check network stability. A mass disconnect often indicates a network issue or server restart.',
            severity:
                (store.counterRates.devices_disconnected ?? 0) > 50
                    ? 'critical'
                    : 'warning'
        });
    }
    return list;
});

function fmtRate(rate?: number): string | number {
    return rate ?? 0;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}
</script>

<style scoped>
/* -- Disabled state -- */
.di-disabled-text { color: var(--color-text-tertiary); }
.di-enable-btn {
    background-color: var(--color-primary-hover);
    color: var(--primitive-blue-100);
}
.di-enable-btn:hover { background-color: var(--color-primary); }

/* -- Block titles & hints -- */
.di-block-title { color: var(--color-text-secondary); }
.di-hint-text { color: var(--color-text-disabled); }
.di-chart-label { color: var(--color-text-disabled); }

/* -- Counter cards -- */
.di-counter-card { background-color: var(--color-surface-1); }
.di-counter-label { color: var(--color-text-disabled); }
.di-counter-value { color: var(--color-text-secondary); }
.di-counter-rate { color: var(--color-primary-text); }

/* -- Row borders -- */
.di-row-border { border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent); }

/* -- ID highlights -- */
.di-id-text { color: var(--color-primary-text); }
.di-id-warning { color: var(--color-orange-text); }
.di-error-text { color: var(--color-text-tertiary); }

/* -- Duration colors -- */
.di-duration-critical { color: var(--color-danger-text); }
.di-duration-warning { color: var(--color-warning-text); }
.di-duration-ok { color: var(--color-success-text); }
</style>
