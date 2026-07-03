<template>
    <Teleport to="body">
        <transition name="drawer">
            <div
                v-if="open"
                class="drilldown-overlay"
                role="dialog"
                aria-modal="true"
                :aria-label="`Module details: ${nodeId ?? ''}`"
                @click.self="close"
                @keydown.esc="close"
            >
                <aside class="drilldown-panel" tabindex="-1">
                    <header class="drilldown-header">
                        <div>
                            <h2 class="drilldown-title">{{ headline }}</h2>
                            <p v-if="description" class="drilldown-subtitle">
                                {{ description }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="drilldown-close"
                            aria-label="Close"
                            @click="close"
                        >
                            ×
                        </button>
                    </header>

                    <section v-if="errorMessage" class="drilldown-error">
                        {{ errorMessage }}
                    </section>

                    <section class="drilldown-section">
                        <h3 class="section-title">Current stats</h3>
                        <table v-if="currentStatEntries.length > 0" class="stat-table">
                            <tbody>
                                <tr v-for="row in currentStatEntries" :key="row.key">
                                    <th class="stat-key">{{ row.key }}</th>
                                    <td class="stat-value">{{ row.value }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-else class="empty-line">No stats available.</p>
                    </section>

                    <section class="drilldown-section">
                        <h3 class="section-title">Recent samples ({{ historyWindowLabel }})</h3>
                        <div v-if="numericTrends.length > 0" class="trend-grid">
                            <div v-for="trend in numericTrends" :key="trend.key" class="trend-card">
                                <div class="trend-label">{{ trend.key }}</div>
                                <div class="trend-value">{{ trend.latest }}</div>
                                <svg
                                    class="trend-spark"
                                    :viewBox="`0 0 ${SPARK_BOX.width} ${SPARK_BOX.height}`"
                                    preserveAspectRatio="none"
                                    role="img"
                                    :aria-label="`${trend.key} trend`"
                                >
                                    <title>{{ trend.key }} trend</title>
                                    <polyline
                                        :points="trend.points"
                                        fill="none"
                                        stroke="var(--color-primary)"
                                        stroke-width="1"
                                    />
                                </svg>
                            </div>
                        </div>
                        <p v-else class="empty-line">No history yet.</p>
                    </section>

                    <section class="drilldown-section">
                        <h3 class="section-title">
                            Recent logs ({{ relevantLogs.length }})
                        </h3>
                        <div v-if="relevantLogs.length > 0" class="log-list">
                            <div
                                v-for="(log, idx) in relevantLogs"
                                :key="`${log.ts}-${idx}`"
                                class="log-entry"
                                :class="`log-${log.level}`"
                            >
                                <span class="log-time">{{ formatTimeOfDay(log.ts) }}</span>
                                <span class="log-level">{{ log.level }}</span>
                                <span class="log-msg">{{ log.message }}</span>
                            </div>
                        </div>
                        <p v-else class="empty-line">No log entries for this module yet.</p>
                    </section>

                    <footer v-if="route" class="drilldown-footer">
                        <router-link :to="route" class="route-link" @click="close">
                            Open full module page →
                        </router-link>
                    </footer>
                </aside>
            </div>
        </transition>
    </Teleport>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {sparklinePoints} from '@/helpers/edgeSparkline';
import {formatTimeOfDay} from '@/helpers/format';
import {
    redactMonitoringField,
    shouldRedactMonitoringKey
} from '@/helpers/monitoringRedaction';
import {useLogStore} from '@/stores/console';
import {useTopologyStore} from '@/stores/topology';
import {sendRPC} from '@/tools/websocket';
import type {TopologyNode} from '@/types/topology';

interface ModuleHistorySample {
    ts: number;
    stats: Record<string, unknown>;
}

const props = defineProps<{nodeId: string | null}>();
const emit = defineEmits<{close: []}>();

const SPARK_BOX = {width: 80, height: 24};
const HISTORY_WINDOW_SEC = 300;

const topology = useTopologyStore();
const logStore = useLogStore();

const history = ref<ModuleHistorySample[]>([]);
const errorMessage = ref<string | null>(null);

const open = computed(() => props.nodeId !== null);

const node = computed<TopologyNode | null>(() => {
    if (!props.nodeId || !topology.current) return null;
    return topology.current.nodes.find((n) => n.id === props.nodeId) ?? null;
});

const headline = computed(() => node.value?.label ?? props.nodeId ?? '');
const description = computed(() => node.value?.description ?? null);
const route = computed(() => node.value?.route ?? null);

const currentStatEntries = computed(() => {
    const stats = node.value?.stats ?? {};
    return Object.entries(stats).map(([key, value]) => ({
        key,
        value: formatStat(redactMonitoringField(key, value))
    }));
});

interface NumericTrend {
    key: string;
    points: string;
    latest: string;
}

const numericTrends = computed<NumericTrend[]>(() => {
    if (history.value.length < 2) return [];
    const seriesByKey = collectNumericSeries(history.value);
    return Array.from(seriesByKey.entries()).map(([key, samples]) => ({
        key,
        points: sparklinePoints(samples, SPARK_BOX),
        latest: formatStat(samples[samples.length - 1])
    }));
});

const historyWindowLabel = computed(() => `${HISTORY_WINDOW_SEC / 60} min`);

const relevantLogs = computed(() => {
    const id = props.nodeId;
    if (!id) return [];
    return logStore.logs
        .filter((l) => l.category === id)
        .slice(-50)
        .reverse();
});

function close(): void {
    emit('close');
}

function collectNumericSeries(
    samples: readonly ModuleHistorySample[]
): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const sample of samples) {
        for (const [key, value] of Object.entries(sample.stats)) {
            if (shouldRedactMonitoringKey(key)) continue;
            if (typeof value !== 'number') continue;
            const series = out.get(key) ?? [];
            series.push(value);
            out.set(key, series);
        }
    }
    return out;
}

type StatFormatter = (value: unknown) => string;

const STAT_FORMATTERS: Record<string, StatFormatter> = {
    number: (value) => formatNumber(value as number),
    boolean: (value) => ((value as boolean) ? 'true' : 'false'),
    string: (value) => value as string
};

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatStat(value: unknown): string {
    const formatter = STAT_FORMATTERS[typeof value];
    return formatter ? formatter(value) : JSON.stringify(value);
}


async function requestModuleHistory(
    id: string
): Promise<ModuleHistorySample[]> {
    const data = await sendRPC<{samples: ModuleHistorySample[]}>(
        'FLEET_MANAGER',
        'System.GetModuleHistory',
        {name: id, windowSec: HISTORY_WINDOW_SEC}
    );
    return data.samples;
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : 'Failed to fetch history';
}

async function loadHistory(id: string): Promise<void> {
    try {
        history.value = await requestModuleHistory(id);
        errorMessage.value = null;
    } catch (err) {
        errorMessage.value = describeError(err);
        history.value = [];
    }
}

watch(
    () => props.nodeId,
    (id) => {
        if (!id) {
            history.value = [];
            return;
        }
        void loadHistory(id);
    },
    {immediate: true}
);

</script>

<style scoped>
.drilldown-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-surface-bg) 70%, transparent);
    display: flex;
    justify-content: flex-end;
    z-index: 60;
}
.drilldown-panel {
    width: min(40rem, 100vw);
    max-width: 100vw;
    height: 100%;
    background: var(--color-surface-2);
    border-left: 1px solid var(--color-surface-3);
    padding: var(--space-5);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.drilldown-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
}
.drilldown-title {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.drilldown-subtitle {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    margin-top: var(--space-1);
}
.drilldown-close {
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    font-size: var(--icon-size-lg);
    cursor: pointer;
    padding: 0 var(--space-2);
}
.drilldown-close:hover {
    color: var(--color-text-primary);
}
.drilldown-error {
    padding: var(--space-2) var(--space-3);
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
}
.section-title {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-2);
}
.stat-table {
    width: 100%;
    border-collapse: collapse;
}
.stat-table tr {
    border-bottom: 1px solid var(--color-surface-3);
}
.stat-key {
    text-align: left;
    color: var(--color-text-secondary);
    font-weight: 500;
    padding: var(--space-1-5) 0;
    font-size: var(--type-caption);
}
.stat-value {
    text-align: right;
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    padding: var(--space-1-5) 0;
    font-size: var(--type-caption);
}
.trend-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-3);
}
.trend-card {
    background: var(--color-surface-1);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
}
.trend-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.trend-value {
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    margin: var(--space-1) 0;
}
.trend-spark {
    width: 100%;
    height: 24px;
}
.log-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
}
.log-entry {
    display: flex;
    gap: var(--space-2);
    font-size: var(--type-caption);
    font-family: var(--font-mono, monospace);
    color: var(--color-text-secondary);
    padding: var(--space-0-5) 0;
}
.log-time {
    color: var(--color-text-quaternary);
    flex-shrink: 0;
}
.log-level {
    text-transform: uppercase;
    font-weight: 600;
    width: 5ch;
    flex-shrink: 0;
}
.log-msg {
    flex: 1;
    word-break: break-word;
}
.log-error,
.log-fatal {
    color: var(--color-danger-text);
}
.log-warn {
    color: var(--color-warning-text);
}
.empty-line {
    color: var(--color-text-quaternary);
    font-size: var(--type-caption);
}
.drilldown-footer {
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-surface-3);
}
.route-link {
    color: var(--color-primary);
    font-weight: 600;
    text-decoration: none;
}
.route-link:hover {
    text-decoration: underline;
}
.drawer-enter-active,
.drawer-leave-active {
    transition: opacity var(--duration-normal) var(--ease-default, ease);
}
.drawer-enter-from,
.drawer-leave-to {
    opacity: 0;
}
@media (max-width: 768px) {
    .drilldown-panel {
        width: 100vw;
    }
}
</style>
