<template>
    <div class="space-y-4 p-2">
        <h2 class="sr-only">Database</h2>
        <!-- Tier gate -->
        <BasicBlock v-if="store.obsLevel < 2" darker class="text-center py-8">
            <p class="text-[var(--color-text-tertiary)]">Set observability to Medium or higher to see database metrics.</p>
            <button
                class="mt-3 px-4 py-2 text-sm font-mono rounded bg-[var(--color-warning)] text-[var(--color-warning-text)] hover:bg-[var(--color-warning-hover)] transition-colors"
                @click="store.changeLevel(2)"
            >Enable Medium Monitoring</button>
        </BasicBlock>

        <template v-if="store.obsLevel >= 1 && store.latest">
            <!-- Insight Panel -->
            <InsightPanel :insights="insights" />

            <!-- Connection Pool -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <HealthDot :status="store.databaseStatus" />
                        <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Connection Pool</h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Active / Total</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-primary)]">
                                {{ store.latest.dbPoolTotal - store.latest.dbPoolIdle }} / {{ store.latest.dbPoolTotal }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Idle</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-success-text)]">{{ store.latest.dbPoolIdle }}</span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Waiting</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="store.latest.dbPoolWaiting > 5 ? 'text-[var(--color-danger-text)]' : store.latest.dbPoolWaiting > 0 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-primary)]'">
                                    {{ store.latest.dbPoolWaiting }}
                                </span>
                                <SparkLine :data="cachedHistory.dbPoolWaiting" color="#fbbf24" :width="60" :height="20" />
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Avg Query Latency</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="durationColor(store.latest.dbAvgMs)">
                                    {{ store.latest.dbAvgMs }}ms
                                </span>
                                <SparkLine :data="cachedHistory.dbAvgMs" color="#60a5fa" :width="60" :height="20" />
                            </div>
                        </div>
                    </div>
                    <!-- Pool bar visualization -->
                    <div class="w-full h-3 bg-[var(--color-surface-1)] rounded-full overflow-hidden flex">
                        <div
                            class="h-full bg-[var(--color-primary)] transition-all"
                            :style="{width: poolActivePercent + '%'}"
                            :title="`Active: ${store.latest.dbPoolTotal - store.latest.dbPoolIdle}`"
                        />
                        <div
                            class="h-full bg-[var(--color-success)] transition-all"
                            :style="{width: poolIdlePercent + '%'}"
                            :title="`Idle: ${store.latest.dbPoolIdle}`"
                        />
                    </div>
                    <div class="flex gap-4 text-xs font-mono text-[var(--color-text-disabled)]">
                        <span><span class="inline-block w-2 h-2 rounded-sm bg-[var(--color-primary)] mr-1" />Active</span>
                        <span><span class="inline-block w-2 h-2 rounded-sm bg-[var(--color-success)] mr-1" />Idle</span>
                    </div>
                </div>
            </BasicBlock>

            <!-- Status Pipeline + Audit Queue -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Write Pipelines</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Status Queue</div>
                            <span class="text-sm font-mono font-semibold" :class="store.latest.statusQueueSize > 100 ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-primary)]'">
                                {{ store.latest.statusQueueSize }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Status Flushing</div>
                            <span class="text-sm font-mono font-semibold" :class="store.latest.statusFlushing ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-primary)]'">
                                {{ store.latest.statusFlushing ? 'Yes' : 'No' }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Audit Queue</div>
                            <span class="text-sm font-mono font-semibold" :class="store.latest.auditQueueLength > 100 ? 'text-[var(--color-danger-text)]' : store.latest.auditQueueLength > 50 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-primary)]'">
                                {{ store.latest.auditQueueLength }}
                            </span>
                        </div>
                        <div v-if="store.obsLevel >= 2" class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Flush Rates</div>
                            <div class="text-xs font-mono">
                                <div class="text-[var(--color-text-tertiary)]">status: <span class="text-[var(--color-text-primary)]">{{ store.counterRates.status_flushes ?? 0 }}/min</span></div>
                                <div class="text-[var(--color-text-tertiary)]">audit: <span class="text-[var(--color-text-primary)]">{{ store.counterRates.audit_flushes ?? 0 }}/min</span></div>
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Last Flush Duration</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="flushDurationColor(store.latestMetrics?.modules?.statusQueue?.lastFlushMs ?? 0)">
                                    {{ store.latestMetrics?.modules?.statusQueue?.lastFlushMs ?? 0 }}ms
                                </span>
                                <SparkLine :data="cachedHistory.lastFlushMs" color="#fbbf24" :width="60" :height="20" />
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Last Flush Batch</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latestMetrics?.modules?.statusQueue?.lastFlushBatchSize ?? 0 }} rows
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Status Cache</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latestMetrics?.modules?.statusQueue?.statusCacheEntries ?? 0 }} entries
                            </span>
                            <div class="text-xs font-mono text-[var(--color-text-disabled)] mt-0.5">
                                {{ store.latestMetrics?.modules?.statusQueue?.statusCacheDevices ?? 0 }} devices
                            </div>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- DB Performance Charts -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Performance Over Time</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Pool Waiting Queries</div>
                            <TimeSeriesChart
                                :data="cachedHistory.dbPoolWaiting"
                                label="Waiting"
                                color="#fbbf24"
                                :thresholds="[{value: 1, color: '#fbbf24', label: 'Warning'}, {value: 5, color: '#f87171', label: 'Critical'}]"
                                :height="160"
                            />
                        </div>
                        <div>
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Avg Query Latency</div>
                            <TimeSeriesChart
                                :data="cachedHistory.dbAvgMs"
                                label="Avg Latency"
                                color="#60a5fa"
                                unit="ms"
                                :thresholds="[{value: 200, color: '#fbbf24', label: 'Warning'}, {value: 500, color: '#f87171', label: 'Critical'}]"
                                :height="160"
                            />
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- DB Timings Table (Tier 2+) -->
            <BasicBlock v-if="store.obsLevel >= 2 && store.latestMetrics?.dbTimings" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">DB Query Timings</h3>
                    <div class="overflow-auto max-h-80">
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
                                <tr v-for="row in sortedDbTimings" :key="row.method" class="border-b border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)]">
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
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import type {Insight} from '@/components/monitoring/InsightPanel.vue';
import InsightPanel from '@/components/monitoring/InsightPanel.vue';
import SparkLine from '@/components/monitoring/SparkLine.vue';
import TimeSeriesChart from '@/components/monitoring/TimeSeriesChart.vue';
import {useMonitoringStore} from '@/stores/monitoring';

const store = useMonitoringStore();

// ── Cached history fields ────────────────────────────────────────
const cachedHistory = computed(() => ({
    dbPoolWaiting: store.historyField('dbPoolWaiting'),
    dbAvgMs: store.historyField('dbAvgMs'),
    lastFlushMs: store.historyField('lastFlushMs')
}));

// ── Pool visualization ─────────────────────────────────────────────
const poolActivePercent = computed(() => {
    if (!store.latest || store.latest.dbPoolTotal === 0) return 0;
    return Math.round(
        ((store.latest.dbPoolTotal - store.latest.dbPoolIdle) /
            store.latest.dbPoolTotal) *
            100
    );
});
const poolIdlePercent = computed(() => {
    if (!store.latest || store.latest.dbPoolTotal === 0) return 0;
    return Math.round(
        (store.latest.dbPoolIdle / store.latest.dbPoolTotal) * 100
    );
});

// ── DB Timings sorting ─────────────────────────────────────────────
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

const sortedDbTimings = computed(() => {
    if (!store.latestMetrics?.dbTimings) return [];
    const entries = Object.entries(store.latestMetrics.dbTimings).map(
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

function durationColor(ms: number): string {
    if (ms > 1000) return 'text-[var(--color-danger-text)]';
    if (ms > 200) return 'text-[var(--color-warning-text)]';
    return 'text-[var(--color-success-text)]';
}

function flushDurationColor(ms: number): string {
    if (ms > 500) return 'text-[var(--color-danger-text)]';
    if (ms > 200) return 'text-[var(--color-warning-text)]';
    return 'text-[var(--color-text-secondary)]';
}

const insights = computed<Insight[]>(() => {
    const list: Insight[] = [];
    const s = store.latest;
    if (!s) return list;
    if (s.dbPoolWaiting > 5) {
        list.push({
            icon: 'fa-solid fa-database',
            title: 'DB Pool Exhausted',
            description: `${s.dbPoolWaiting} queries waiting for a connection. All ${s.dbPoolTotal} pool connections are active.`,
            action: 'Increase DB pool size, optimize slow queries, or check for connection leaks.',
            severity: 'critical'
        });
    } else if (s.dbPoolWaiting > 0) {
        list.push({
            icon: 'fa-solid fa-database',
            title: 'DB Pool Under Pressure',
            description: `${s.dbPoolWaiting} queries waiting. Pool is approaching capacity.`,
            action: 'Monitor pool usage. If persistent, consider increasing pool size.',
            severity: 'warning'
        });
    }
    if (s.dbAvgMs > 500) {
        list.push({
            icon: 'fa-solid fa-clock',
            title: 'High DB Latency',
            description: `Average query latency is ${s.dbAvgMs}ms. This impacts all DB-dependent operations.`,
            action: 'Check for lock contention, missing indexes, or heavy queries. Inspect DB server load.',
            severity: s.dbAvgMs > 1000 ? 'critical' : 'warning'
        });
    }
    return list;
});
</script>
