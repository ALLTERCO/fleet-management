<template>
    <div class="space-y-4 p-2">
        <h2 class="sr-only">RPC Commands</h2>
        <!-- Tier gate -->
        <BasicBlock v-if="store.obsLevel < 2" darker class="text-center py-8">
            <p class="text-[var(--color-text-tertiary)]">Set observability to Medium or higher to see RPC command metrics.</p>
            <button
                class="mt-3 px-4 py-2 text-sm font-mono rounded bg-[var(--color-warning)] text-[var(--color-warning-text)] hover:bg-[var(--color-warning-hover)] transition-colors"
                @click="store.changeLevel(2)"
            >Enable Medium Monitoring</button>
        </BasicBlock>

        <EmptyBlock v-else-if="store.obsLevel >= 2 && !store.latestMetrics">
            <Spinner />
            <p class="text-sm pt-2">Waiting for metrics data...</p>
        </EmptyBlock>

        <template v-if="store.obsLevel >= 2 && store.latestMetrics">
            <!-- Insight Panel -->
            <InsightPanel :insights="insights" />

            <!-- Summary -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <HealthDot :status="store.rpcCommandsStatus" />
                        <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">RPC Command Health</h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Avg Latency</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="durationColor(store.latest?.rpcAvgMs ?? 0)">
                                    {{ store.latest?.rpcAvgMs ?? 0 }}ms
                                </span>
                                <SparkLine :data="cachedHistory.rpcAvgMs" color="#34d399" :width="60" :height="20" />
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Error Rate</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="(store.latest?.rpcErrorRate ?? 0) > 2 ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-primary)]'">
                                    {{ store.latest?.rpcErrorRate ?? 0 }}/min
                                </span>
                                <SparkLine :data="cachedHistory.rpcErrorRate" color="#f87171" :width="60" :height="20" />
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Success/min</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-success-text)]">{{ store.counterRates.rpc_success ?? 0 }}</span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Errors/min</div>
                            <span class="text-sm font-mono font-semibold" :class="(store.counterRates.rpc_errors ?? 0) > 0 ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-primary)]'">
                                {{ store.counterRates.rpc_errors ?? 0 }}
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- RPC Timings Table -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center justify-between">
                        <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">RPC Timings</h3>
                        <button
                            class="px-3 py-1 text-xs font-mono rounded bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] transition-colors"
                            @click="resetTimings"
                        >Reset</button>
                    </div>
                    <div v-if="sortedRpcTimings.length === 0" class="text-center py-6 text-[var(--color-text-disabled)] text-xs font-mono">
                        No RPC timings recorded yet
                    </div>
                    <div v-else class="overflow-auto max-h-80">
                        <table class="w-full text-xs font-mono">
                            <thead>
                                <tr class="text-[var(--color-text-disabled)] border-b border-[var(--color-border-default)]">
                                    <th class="text-left py-1.5 px-2 cursor-pointer hover:text-[var(--color-text-secondary)]" @click="sortBy('method')">
                                        Method {{ sortIndicator('method') }}
                                    </th>
                                    <th class="text-right py-1.5 px-2 cursor-pointer hover:text-[var(--color-text-secondary)]" @click="sortBy('count')">
                                        Count {{ sortIndicator('count') }}
                                    </th>
                                    <th class="text-right py-1.5 px-2 cursor-pointer hover:text-[var(--color-text-secondary)]" @click="sortBy('avgMs')">
                                        Avg ms {{ sortIndicator('avgMs') }}
                                    </th>
                                    <th class="text-right py-1.5 px-2 cursor-pointer hover:text-[var(--color-text-secondary)]" @click="sortBy('maxMs')">
                                        Max ms {{ sortIndicator('maxMs') }}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in sortedRpcTimings" :key="row.method" class="border-b border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)]">
                                    <td class="py-1.5 px-2 text-[var(--color-text-secondary)]">{{ row.method }}</td>
                                    <td class="py-1.5 px-2 text-right text-[var(--color-text-tertiary)]">{{ row.count }}</td>
                                    <td class="py-1.5 px-2 text-right" :class="durationColor(row.avgMs)">{{ row.avgMs }}</td>
                                    <td class="py-1.5 px-2 text-right" :class="durationColor(row.maxMs)">{{ row.maxMs }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </BasicBlock>

            <!-- RPC Performance Charts -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Performance Over Time</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">RPC Avg Latency</div>
                            <TimeSeriesChart
                                :data="cachedHistory.rpcAvgMs"
                                label="Avg Latency"
                                color="#34d399"
                                unit="ms"
                                :thresholds="[{value: 500, color: '#fbbf24', label: 'Warning'}, {value: 1000, color: '#f87171', label: 'Critical'}]"
                                :height="160"
                            />
                        </div>
                        <div>
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">RPC Error Rate</div>
                            <TimeSeriesChart
                                :data="cachedHistory.rpcErrorRate"
                                label="Errors/min"
                                color="#f87171"
                                unit="/min"
                                :thresholds="[{value: 2, color: '#fbbf24', label: 'Warning'}, {value: 10, color: '#f87171', label: 'Critical'}]"
                                :height="160"
                            />
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- RPC Errors -->
            <BasicBlock v-if="rpcErrors.length > 0" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">
                        Recent RPC Errors
                        <span class="text-[var(--color-text-disabled)] font-normal">(last {{ rpcErrors.length }})</span>
                    </h3>
                    <div class="max-h-64 overflow-auto">
                        <div
                            v-for="(entry, i) in rpcErrors"
                            :key="i"
                            class="flex items-center gap-3 text-xs font-mono border-b border-[var(--color-border-default)] py-1.5"
                        >
                            <span class="text-[var(--color-text-disabled)] w-16 flex-shrink-0">{{ formatTime(entry.ts) }}</span>
                            <span class="text-[var(--color-danger-text)] flex-shrink-0">{{ entry.method }}</span>
                            <span class="text-[var(--color-text-tertiary)] truncate">{{ entry.error }}</span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Frontend RPC Ring Buffer (Tier 3) -->
            <BasicBlock v-if="store.obsLevel >= 3 && store.rpcTimings.length > 0" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Frontend RPC Timings</h3>
                    <div class="flex gap-4 text-xs font-mono text-[var(--color-text-tertiary)] mb-2">
                        <span>WS msg/s: {{ store.wsMessagesPerSec }}</span>
                        <span>Pending RPCs: {{ store.pendingRpcCount }}</span>
                    </div>
                    <div class="max-h-48 overflow-auto">
                        <div
                            v-for="(entry, i) in clientTimingsReversed"
                            :key="i"
                            class="flex items-center gap-3 text-xs font-mono"
                        >
                            <span class="text-[var(--color-text-disabled)] w-16">{{ formatTime(entry.ts) }}</span>
                            <span class="flex-1 text-[var(--color-text-secondary)]">{{ entry.method }}</span>
                            <span class="w-16 text-right font-semibold" :class="durationColor(entry.durationMs)">{{ entry.durationMs }}ms</span>
                        </div>
                    </div>
                </div>
            </BasicBlock>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Spinner from '@/components/core/Spinner.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import type {Insight} from '@/components/monitoring/InsightPanel.vue';
import InsightPanel from '@/components/monitoring/InsightPanel.vue';
import SparkLine from '@/components/monitoring/SparkLine.vue';
import TimeSeriesChart from '@/components/monitoring/TimeSeriesChart.vue';
import {useMonitoringStore} from '@/stores/monitoring';

const store = useMonitoringStore();

// ── Cached history fields ────────────────────────────────────────
const cachedHistory = computed(() => ({
    rpcAvgMs: store.historyField('rpcAvgMs'),
    rpcErrorRate: store.historyField('rpcErrorRate')
}));

// ── Sorting ────────────────────────────────────────────────────────
const sortKey = ref('method');
const sortAsc = ref(true);

function sortBy(key: string) {
    if (sortKey.value === key) sortAsc.value = !sortAsc.value;
    else {
        sortKey.value = key;
        sortAsc.value = true;
    }
}

function sortIndicator(key: string): string {
    if (sortKey.value !== key) return '';
    return sortAsc.value ? '\u25B2' : '\u25BC';
}

const sortedRpcTimings = computed(() => {
    if (!store.latestMetrics?.rpcTimings) return [];
    const entries = Object.entries(store.latestMetrics.rpcTimings).map(
        ([method, stats]: [string, any]) => ({
            method,
            ...stats
        })
    );
    const key = sortKey.value;
    const asc = sortAsc.value;
    entries.sort((a: any, b: any) => {
        const av = a[key],
            bv = b[key];
        if (typeof av === 'string')
            return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        return asc ? av - bv : bv - av;
    });
    return entries;
});

// ── RPC Errors ─────────────────────────────────────────────────────
const rpcErrors = computed(() => store.latestMetrics?.rpcErrors ?? []);

// ── Client-side timings (reversed for newest first) ────────────────
const clientTimingsReversed = computed(() => [...store.rpcTimings].reverse());

// ── Reset ──────────────────────────────────────────────────────────
async function resetTimings() {
    await fetch('/health/observability/reset', {method: 'POST'}).catch(
        () => {}
    );
    store.fetchAndRecord();
}

// ── Helpers ────────────────────────────────────────────────────────
function durationColor(ms: number): string {
    if (ms > 1000) return 'text-[var(--color-danger-text)]';
    if (ms > 200) return 'text-[var(--color-warning-text)]';
    return 'text-[var(--color-success-text)]';
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

const insights = computed<Insight[]>(() => {
    const list: Insight[] = [];
    const s = store.latest;
    if (!s) return list;
    if (s.rpcAvgMs > 1000) {
        list.push({
            icon: 'fa-solid fa-gauge-high',
            title: 'Critical RPC Latency',
            description: `Average RPC latency is ${s.rpcAvgMs}ms. Device commands are severely delayed.`,
            action: 'Check backend load, database latency, and device connectivity. Look for slow command handlers.',
            severity: 'critical'
        });
    } else if (s.rpcAvgMs > 500) {
        list.push({
            icon: 'fa-solid fa-gauge-high',
            title: 'High RPC Latency',
            description: `Average RPC latency is ${s.rpcAvgMs}ms. Commands are taking longer than expected.`,
            action: 'Review slow RPC methods in the timings table below. Check DB query performance.',
            severity: 'warning'
        });
    }
    if (s.rpcErrorRate > 10) {
        list.push({
            icon: 'fa-solid fa-triangle-exclamation',
            title: 'High RPC Error Rate',
            description: `${s.rpcErrorRate} RPC errors/min. Many device commands are failing.`,
            action: 'Check device connectivity, firmware compatibility, and recent RPC errors below.',
            severity: 'critical'
        });
    } else if (s.rpcErrorRate > 2) {
        list.push({
            icon: 'fa-solid fa-triangle-exclamation',
            title: 'Elevated RPC Errors',
            description: `${s.rpcErrorRate} errors/min. Some device commands are failing.`,
            action: 'Review error details below. May indicate device timeouts or unreachable devices.',
            severity: 'warning'
        });
    }
    return list;
});
</script>
