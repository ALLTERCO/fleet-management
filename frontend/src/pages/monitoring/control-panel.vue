<template>
    <PageTemplate title="Control Panel" :tabs="monitoringTabs" back="/monitoring/investigate" active-path="/monitoring/investigate" fill>
        <h2 class="sr-only">Control Panel</h2>

        <BasicBlock darker>
            <div class="cp-stack">
                <MonitoringSectionHeader
                    title="Observability Level"
                    icon="fas fa-satellite-dish"
                >
                    <template #actions>
                        <button class="cp-secondary-btn" @click="exportReport">
                            <i class="fas fa-file-export" />Export Debug Report
                        </button>
                    </template>
                </MonitoringSectionHeader>
                <p class="cp-hint">
                    Controls what metrics are collected (backend) and displayed (frontend). Higher levels add more detail but increase overhead.
                </p>
                <div class="cp-level-grid">
                    <button
                        v-for="(desc, i) in obsLevelDescriptions"
                        :key="i"
                        class="cp-level-btn"
                        :class="store.obsLevel === i ? levelActiveClass(i) : 'cp-level-btn--inactive'"
                        @click="store.changeLevel(i as ObsLevel)"
                    >
                        <div class="cp-level-name">{{ OBS_LEVEL_LABELS[i] }}</div>
                        <div class="cp-level-desc">{{ desc }}</div>
                    </button>
                </div>
            </div>
        </BasicBlock>

        <BasicBlock darker>
            <div class="cp-stack">
                <MonitoringSectionHeader
                    title="Backend Log Levels"
                    icon="fas fa-scroll"
                >
                    <template #actions>
                        <div class="cp-row">
                            <span class="cp-hint">Set All:</span>
                            <select
                                aria-label="Set all log levels"
                                class="cp-select"
                                @change="onSetAll($event)"
                            >
                                <option value="" disabled selected>—</option>
                                <option v-for="lvl in LOG_LEVELS" :key="lvl" :value="lvl">{{ lvl }}</option>
                            </select>
                        </div>
                    </template>
                </MonitoringSectionHeader>
                <p class="cp-hint">
                    Change log verbosity per backend module at runtime. Changes take effect immediately but do not persist across restarts.
                </p>
                <div v-if="Object.keys(store.logLevels).length === 0" class="cp-load-row">
                    <button class="cp-secondary-btn" @click="store.fetchLogLevels()">
                        Load Log Levels
                    </button>
                </div>
                <div v-else class="cp-stack">
                    <div v-for="group in groupedLogLevels" :key="group.name">
                        <button class="cp-group-btn" @click="toggleGroup(group.name)">
                            <i
                                class="fas fa-chevron-right cp-group-chevron"
                                :class="{ 'cp-group-chevron--open': expandedGroups[group.name] }"
                            />
                            <i :class="group.icon" class="cp-group-icon" :style="{ color: group.color }" />
                            <span class="cp-group-name">{{ group.name }}</span>
                            <span class="cp-group-count">({{ group.entries.length }})</span>
                        </button>
                        <div v-if="expandedGroups[group.name]" class="cp-log-grid">
                            <div
                                v-for="[category, level] in group.entries"
                                :key="category"
                                class="cp-log-row"
                            >
                                <span class="cp-log-category" :title="category">{{ category }}</span>
                                <select
                                    :aria-label="`Log level for ${category}`"
                                    class="cp-select cp-select--sm"
                                    :class="logLevelColor(String(level))"
                                    :value="level"
                                    @change="onLevelChange(category, ($event.target as HTMLSelectElement).value)"
                                >
                                    <option v-for="lvl in LOG_LEVELS" :key="lvl" :value="lvl">{{ lvl }}</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </BasicBlock>

        <BasicBlock v-if="store.obsLevel >= 2" darker>
            <div class="cp-stack">
                <MonitoringSectionHeader
                    title="Interaction Telemetry"
                    icon="fas fa-chart-bar"
                >
                    <template #actions>
                        <span class="cp-hint">{{ interactionsList.length }} events tracked</span>
                    </template>
                </MonitoringSectionHeader>
                <p class="cp-hint">
                    Counts of user interactions since page load. Included in debug report exports.
                </p>
                <div v-if="Object.keys(interactionCountsSnapshot).length > 0" class="cp-counter-grid">
                    <div
                        v-for="[key, count] in sortedInteractionCounts"
                        :key="key"
                        class="cp-counter-card"
                    >
                        <span class="cp-log-category" :title="key">{{ key }}</span>
                        <span class="cp-counter-val">{{ count }}</span>
                    </div>
                </div>
                <div v-else class="cp-empty-inline">
                    No interactions recorded yet.
                </div>
            </div>
        </BasicBlock>

        <BasicBlock v-if="store.obsLevel >= 2" darker>
            <div class="cp-stack">
                <MonitoringSectionHeader title="Click Heatmap" icon="fas fa-fire" />
                <p class="cp-hint">
                    Overlays a real-time heatmap of click positions on the UI. Useful for identifying interaction hotspots and dead zones. Data from the last 5 minutes.
                </p>
                <div class="cp-toggle-row">
                    <button
                        class="cp-switch"
                        :class="heatmapOn ? 'cp-switch--on' : 'cp-switch--off'"
                        :aria-label="heatmapOn ? 'Disable click heatmap' : 'Enable click heatmap'"
                        role="switch"
                        :aria-checked="heatmapOn"
                        @click="toggleHeatmap(!heatmapOn)"
                    >
                        <span class="cp-switch-knob" :class="heatmapOn ? 'cp-switch-knob--on' : 'cp-switch-knob--off'" />
                    </button>
                    <span class="cp-toggle-label" :class="heatmapOn ? 'cp-text-on' : 'cp-text-off'">
                        {{ heatmapOn ? 'ON' : 'OFF' }}
                    </span>
                </div>
            </div>
        </BasicBlock>

        <BasicBlock darker>
            <div class="cp-stack">
                <MonitoringSectionHeader title="Frontend Debug Mode" icon="fas fa-bug" />
                <p class="cp-hint">
                    Enables verbose browser diagnostic output in DevTools. Independent of observability level. Persists via localStorage.
                </p>
                <div class="cp-toggle-row">
                    <button
                        class="cp-switch"
                        :class="store.frontendDebug ? 'cp-switch--on' : 'cp-switch--off'"
                        :aria-label="store.frontendDebug ? 'Disable frontend debug mode' : 'Enable frontend debug mode'"
                        role="switch"
                        :aria-checked="store.frontendDebug"
                        @click="store.toggleFrontendDebug(!store.frontendDebug)"
                    >
                        <span class="cp-switch-knob" :class="store.frontendDebug ? 'cp-switch-knob--on' : 'cp-switch-knob--off'" />
                    </button>
                    <span class="cp-toggle-label" :class="store.frontendDebug ? 'cp-text-on' : 'cp-text-off'">
                        {{ store.frontendDebug ? 'ON' : 'OFF' }}
                    </span>
                </div>
            </div>
        </BasicBlock>

        <BasicBlock darker>
            <div class="cp-stack">
                <MonitoringSectionHeader title="WS Patch Telemetry" icon="fas fa-wave-square" />
                <p class="cp-hint">
                    Tracks peak patch buffer depth, deferred-frame count, and RAF apply time per frame. Adds minor overhead per WebSocket event. Persists via localStorage.
                </p>
                <div class="cp-toggle-row">
                    <button
                        class="cp-switch"
                        :class="store.wsTelemetryEnabled ? 'cp-switch--on' : 'cp-switch--off'"
                        :aria-label="store.wsTelemetryEnabled ? 'Disable WS patch telemetry' : 'Enable WS patch telemetry'"
                        role="switch"
                        :aria-checked="store.wsTelemetryEnabled"
                        @click="store.toggleWsTelemetry(!store.wsTelemetryEnabled)"
                    >
                        <span class="cp-switch-knob" :class="store.wsTelemetryEnabled ? 'cp-switch-knob--on' : 'cp-switch-knob--off'" />
                    </button>
                    <span class="cp-toggle-label" :class="store.wsTelemetryEnabled ? 'cp-text-on' : 'cp-text-off'">
                        {{ store.wsTelemetryEnabled ? 'ON' : 'OFF' }}
                    </span>
                </div>
                <div v-if="store.wsTelemetryEnabled" class="cp-tele-grid">
                    <div class="cp-tile">
                        <div class="cp-tile-label">Buffer Peak</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.patchBufferMaxDepth }}</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Deferred Frames</div>
                        <span class="cp-tile-value" :class="store.wsTelemetryData.droppedFrameCount > 0 ? 'cp-text-warning' : ''">
                            {{ store.wsTelemetryData.droppedFrameCount }}
                        </span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">RAF Apply Max</div>
                        <span class="cp-tile-value" :class="rafFrameClass">
                            {{ store.wsTelemetryData.rafFrameTimeMaxMs }}ms
                        </span>
                    </div>
                </div>
                <div v-if="store.wsTelemetryEnabled" class="cp-tele-grid">
                    <div class="cp-tile">
                        <div class="cp-tile-label">Shelly.Disconnect Received</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyDisconnectReceived }}</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Disconnect Latency p50</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyDisconnectLatencyMs.p50 }}ms</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Disconnect Latency p95</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyDisconnectLatencyMs.p95 }}ms</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Disconnect Latency max</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyDisconnectLatencyMs.max }}ms</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Shelly.Connect Received</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyConnectReceived }}</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Connect Latency p50</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyConnectLatencyMs.p50 }}ms</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Connect Latency p95</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyConnectLatencyMs.p95 }}ms</span>
                    </div>
                    <div class="cp-tile">
                        <div class="cp-tile-label">Connect Latency max</div>
                        <span class="cp-tile-value">{{ store.wsTelemetryData.shellyConnectLatencyMs.max }}ms</span>
                    </div>
                </div>
            </div>
        </BasicBlock>

        <BasicBlock darker>
            <div class="cp-stack">
                <MonitoringSectionHeader
                    title="Disable Hot-Path DB Writes"
                    icon="fas fa-database"
                >
                    <template #actions>
                        <span class="cp-badge-diagnostic">DIAGNOSTIC</span>
                    </template>
                </MonitoringSectionHeader>
                <p class="cp-hint">
                    Suppresses status flushes, EM stats writes, device state persists, and audit log writes. WebSocket connections, event broadcasting, in-memory state, and RPC commands continue normally. Use for A/B testing whether DB writes are the performance bottleneck.
                    <strong class="cp-text-danger">Resets on restart.</strong>
                </p>
                <div class="cp-toggle-row">
                    <button
                        class="cp-switch"
                        type="button"
                        :class="store.dbWritesDisabled ? 'cp-switch--danger-on' : 'cp-switch--off'"
                        :disabled="dbWritesLoading || !canToggleDbWrites"
                        :aria-label="store.dbWritesDisabled ? 'Enable DB writes' : 'Disable DB writes'"
                        role="switch"
                        :aria-checked="store.dbWritesDisabled"
                        @click="toggleDbWrites"
                    >
                        <span class="cp-switch-knob" :class="store.dbWritesDisabled ? 'cp-switch-knob--on' : 'cp-switch-knob--off'" />
                    </button>
                    <span class="cp-toggle-label" :class="store.dbWritesDisabled ? 'cp-text-danger' : 'cp-text-off'">
                        {{ store.dbWritesDisabled ? 'WRITES DISABLED' : 'NORMAL' }}
                    </span>
                </div>
                <div v-if="store.dbWritesDisabled" class="cp-warning-banner">
                    <i class="fas fa-triangle-exclamation cp-warning-icon" />
                    <span class="cp-warning-text">
                        DB writes are disabled — status history, EM data, and audit logs are NOT being recorded. Queues are being drained to prevent memory growth.
                    </span>
                </div>
            </div>
        </BasicBlock>

        <div
            v-if="dbWritesConfirmOpen"
            class="cp-confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="db-writes-confirm-title"
            @click.self="closeDbWritesConfirm"
            @keydown.esc="closeDbWritesConfirm"
        >
            <section class="cp-confirm-dialog">
                <MonitoringSectionHeader
                    id="db-writes-confirm-title"
                    title="Disable DB writes?"
                    icon="fas fa-triangle-exclamation"
                />
                <p class="cp-hint">
                    This is a live diagnostic switch. It stops status history, EM stats, device state persists, and audit log writes until the app restarts or writes are enabled again.
                </p>
                <label class="cp-confirm-label" for="db-writes-confirm-input">
                    Type {{ DB_WRITES_CONFIRM_PHRASE }} to confirm.
                </label>
                <input
                    id="db-writes-confirm-input"
                    v-model="dbWritesConfirmText"
                    class="cp-confirm-input"
                    autocomplete="off"
                    spellcheck="false"
                >
                <div class="cp-confirm-actions">
                    <button
                        type="button"
                        class="cp-secondary-btn"
                        @click="closeDbWritesConfirm"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="cp-danger-btn"
                        :disabled="!dbWritesConfirmValid || dbWritesLoading"
                        @click="confirmDisableDbWrites"
                    >
                        Disable writes
                    </button>
                </div>
            </section>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject, onMounted, reactive, ref } from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {useLogStore} from '@/stores/console';
import {useMonitoringStore} from '@/stores/monitoring';
import {
    fetchDebugReport,
    getInteractionCounts,
    getInteractions,
    getPendingRpcCount,
    getRpcTimings,
    getWsMessagesPerSec,
    isHeatmapEnabled,
    OBS_LEVEL_LABELS,
    type ObsLevel,
    setHeatmap
} from '@/tools/observability';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const store = useMonitoringStore();
const rpc = useRpcPermissions();
const logStore = useLogStore();
const canToggleDbWrites = computed(() => rpc.canCall('System.DbWrites.Set'));

const heatmapOn = ref(isHeatmapEnabled());
function toggleHeatmap(v: boolean) {
    setHeatmap(v);
    heatmapOn.value = isHeatmapEnabled();
}

const MODULE_CATEGORIES: Record<string, string> = {
    default: 'Core',
    config: 'Core',
    audit: 'Core',
    'frontend-builder': 'Core',
    'node-red-config': 'Core',
    'event-model': 'Core',
    user: 'Core',
    'Plugin Loader': 'Core',
    'plugin-loader': 'Core',
    DeviceCollector: 'Device',
    'message-parser': 'Device',
    AbstractDevice: 'Device',
    device: 'Device',
    'device-proxy': 'Device',
    'shelly-events': 'Device',
    ShellyComponents: 'Device',
    FirmwareScheduler: 'Device',
    FirmwareComponent: 'Device',
    Commander: 'Device',
    GroupComponent: 'Device',
    BackupComponent: 'Device',
    WaitingRoom: 'Device',
    'local-scanner': 'Device',
    registry: 'Device',
    'ws-server': 'Network',
    'shelly-ws': 'Network',
    'client-ws': 'Network',
    'local-ws': 'Network',
    'ws-upgrade': 'Network',
    'message-handler': 'Network',
    web: 'Network',
    api: 'Network',
    'grafana-proxy': 'Network',
    postgres: 'Storage',
    Observability: 'Monitoring'
};

const CATEGORY_META: Record<
    string,
    {icon: string; color: string; order: number}
> = {
    Core: {icon: 'fas fa-cog', color: 'var(--color-primary-text)', order: 0},
    Device: {icon: 'fas fa-microchip', color: 'var(--color-success-text)', order: 1},
    Network: {icon: 'fas fa-network-wired', color: 'var(--color-warning-text)', order: 2},
    Storage: {icon: 'fas fa-database', color: 'var(--color-accent-text)', order: 3},
    Monitoring: {icon: 'fas fa-chart-line', color: 'var(--color-primary-text)', order: 4},
    Other: {icon: 'fas fa-ellipsis', color: 'var(--color-text-disabled)', order: 5}
};

const expandedGroups = reactive<Record<string, boolean>>({
    Core: true,
    Device: true,
    Network: true,
    Storage: true,
    Monitoring: true,
    Other: true
});

function toggleGroup(name: string) {
    expandedGroups[name] = !expandedGroups[name];
}

const groupedLogLevels = computed(() => {
    const groups: Record<string, [string, string][]> = {};
    for (const [category, level] of Object.entries(store.logLevels)) {
        const group = MODULE_CATEGORIES[category] ?? 'Other';
        if (!groups[group]) groups[group] = [];
        groups[group].push([category, String(level)]);
    }
    for (const entries of Object.values(groups)) {
        entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return Object.entries(groups)
        .map(([name, entries]) => ({
            name,
            entries,
            icon: CATEGORY_META[name]?.icon ?? 'fas fa-ellipsis',
            color: CATEGORY_META[name]?.color ?? 'var(--color-text-disabled)'
        }))
        .sort(
            (a, b) =>
                (CATEGORY_META[a.name]?.order ?? 99) -
                (CATEGORY_META[b.name]?.order ?? 99)
        );
});

const LOG_LEVELS = [
    'ALL',
    'TRACE',
    'DEBUG',
    'INFO',
    'WARN',
    'ERROR',
    'FATAL',
    'MARK',
    'OFF'
];

const obsLevelDescriptions = [
    'No collection. Zero overhead.',
    'Basic health: memory, event loop, module stats. Production-safe.',
    'Adds RPC/DB timings, counters, error tracking. Moderate overhead.',
    'Full: WS message rates, pending RPC count. Highest overhead.'
];

function levelActiveClass(level: number): string {
    switch (level) {
        case 0: return 'cp-level-active-off';
        case 1: return 'cp-level-active-light';
        case 2: return 'cp-level-active-medium';
        case 3: return 'cp-level-active-heavy';
        default: return 'cp-level-active-off';
    }
}

function logLevelColor(level: string): string {
    switch (level.toUpperCase()) {
        case 'ALL':
        case 'TRACE':
        case 'DEBUG': return 'cp-log-level-debug';
        case 'INFO': return 'cp-log-level-info';
        case 'WARN': return 'cp-log-level-warn';
        case 'ERROR':
        case 'FATAL': return 'cp-log-level-error';
        case 'OFF': return 'cp-log-level-off';
        default: return 'cp-log-level-default';
    }
}

function onLevelChange(category: string, level: string) {
    store.setLogLevel(category, level);
}

function onSetAll(event: Event) {
    const select = event.target as HTMLSelectElement;
    const level = select.value;
    if (level) {
        store.setAllLogLevels(level);
        select.value = '';
    }
}

async function exportReport() {
    const report = await fetchDebugReport();
    const fullReport = {
        ...report,
        frontend: {
            rpcTimings: [...getRpcTimings()],
            wsMessagesPerSec: getWsMessagesPerSec(),
            pendingRpcCount: getPendingRpcCount(),
            obsLevel: store.obsLevel,
            interactionCounts: {...getInteractionCounts()},
            recentInteractions: [...getInteractions()].slice(-50)
        },
        logs: logStore.formatLogsForExport(logStore.filteredLogs),
        browser: {
            userAgent: navigator.userAgent,
            url: window.location.href,
            timestamp: new Date().toISOString()
        }
    };
    const blob = new Blob([JSON.stringify(fullReport, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

const interactionsList = computed(() => [...getInteractions()]);
const interactionCountsSnapshot = computed(() => ({...getInteractionCounts()}));
const sortedInteractionCounts = computed(() =>
    Object.entries(interactionCountsSnapshot.value).sort((a, b) => b[1] - a[1])
);

const rafFrameClass = computed(() => {
    const v = store.wsTelemetryData.rafFrameTimeMaxMs;
    if (v > 16) return 'cp-text-danger';
    if (v > 8) return 'cp-text-warning';
    return '';
});

const DB_WRITES_CONFIRM_PHRASE = 'DISABLE DB WRITES';
const dbWritesLoading = ref(false);
const dbWritesConfirmOpen = ref(false);
const dbWritesConfirmText = ref('');
const dbWritesConfirmValid = computed(
    () => dbWritesConfirmText.value.trim() === DB_WRITES_CONFIRM_PHRASE
);

onMounted(async () => {
    try {
        const data = await sendRPC<{dbWritesDisabled?: boolean}>(
            'FLEET_MANAGER',
            'System.DbWrites.Get',
            {}
        );
        store.dbWritesDisabled = data.dbWritesDisabled ?? false;
    } catch {
        /* endpoint may not exist yet */
    }
});

async function toggleDbWrites() {
    if (!canToggleDbWrites.value) return;
    if (!store.dbWritesDisabled) {
        dbWritesConfirmText.value = '';
        dbWritesConfirmOpen.value = true;
        return;
    }
    await setDbWritesDisabled(false);
}

function closeDbWritesConfirm() {
    if (dbWritesLoading.value) return;
    dbWritesConfirmOpen.value = false;
    dbWritesConfirmText.value = '';
}

async function confirmDisableDbWrites() {
    if (!dbWritesConfirmValid.value || !canToggleDbWrites.value) return;
    await setDbWritesDisabled(true);
    dbWritesConfirmOpen.value = false;
    dbWritesConfirmText.value = '';
}

async function setDbWritesDisabled(disabled: boolean) {
    dbWritesLoading.value = true;
    try {
        const data = await sendRPC<{dbWritesDisabled: boolean}>(
            'FLEET_MANAGER',
            'System.DbWrites.Set',
            {disabled}
        );
        store.dbWritesDisabled = data.dbWritesDisabled;
    } finally {
        dbWritesLoading.value = false;
    }
}

store.fetchLogLevels();
</script>

<style scoped>
.cp-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.cp-row {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.cp-hint {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}

.cp-secondary-btn {
    padding: var(--gap-xs) var(--gap-sm);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
    transition: background-color var(--duration-fast);
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
}
.cp-secondary-btn:hover {
    background-color: var(--color-surface-4);
}
.cp-danger-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-radius: var(--radius-md);
    background-color: var(--color-danger);
    color: var(--color-text-on-danger);
    transition: opacity var(--duration-fast), background-color var(--duration-fast);
}
.cp-danger-btn:hover:not(:disabled) {
    background-color: var(--color-danger-hover);
}
.cp-danger-btn:disabled {
    cursor: not-allowed;
    opacity: var(--state-disabled-opacity);
}

.cp-level-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
}
.cp-level-btn {
    flex: 1;
    min-width: 140px;
    padding: var(--gap-sm);
    border-radius: var(--radius-lg);
    border: 1px solid transparent;
    text-align: left;
    transition: background-color var(--duration-fast), border-color var(--duration-fast);
}
.cp-level-name {
    font-size: var(--type-body);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
}
.cp-level-desc {
    font-size: var(--type-caption);
    margin-top: var(--gap-xs);
    opacity: 0.75;
}

.cp-level-btn--inactive {
    background-color: var(--color-surface-2);
    border-color: var(--color-border-default);
    color: var(--color-text-tertiary);
}
.cp-level-btn--inactive:hover {
    background-color: var(--color-surface-3);
    border-color: var(--color-border-strong);
}
.cp-level-active-off {
    background-color: var(--color-surface-3);
    border-color: var(--color-text-disabled);
    color: var(--color-text-primary);
}
.cp-level-active-light {
    background-color: color-mix(in srgb, var(--color-primary-subtle) 50%, transparent);
    border-color: var(--color-primary);
    color: var(--primitive-blue-100);
}
.cp-level-active-medium {
    background-color: color-mix(in srgb, var(--color-warning-subtle) 40%, transparent);
    border-color: var(--color-warning);
    color: var(--color-warning-text);
}
.cp-level-active-heavy {
    background-color: color-mix(in srgb, var(--color-danger-subtle) 40%, transparent);
    border-color: var(--color-danger);
    color: var(--primitive-red-300);
}

.cp-select {
    padding: var(--space-1) var(--gap-xs);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    color: var(--color-text-secondary);
}
.cp-select:focus {
    outline: none;
    border-color: var(--color-border-focus);
}
.cp-select--sm {
    border: 1px solid var(--color-border-default);
    min-width: 70px;
    padding: var(--space-0-5) var(--gap-xs);
}

.cp-load-row {
    text-align: center;
    padding: var(--gap-md) 0;
}

.cp-group-btn {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    width: 100%;
    text-align: left;
    padding: var(--space-1) 0;
    cursor: pointer;
}
.cp-group-chevron {
    font-size: var(--icon-size-2xs); /* icon-only */
    color: var(--color-text-disabled);
    transition: transform var(--duration-fast);
}
.cp-group-chevron--open {
    transform: rotate(90deg);
}
.cp-group-icon {
    font-size: var(--type-caption);
}
.cp-group-name {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.cp-group-count {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}

.cp-log-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--gap-xs);
    margin-top: var(--gap-xs);
    margin-left: var(--gap-md);
}
@media (min-width: 768px) {
    .cp-log-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (min-width: 1024px) {
    .cp-log-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

.cp-log-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-md);
}
.cp-log-category {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cp-log-level-debug { color: var(--color-primary-text); }
.cp-log-level-info { color: var(--color-success-text); }
.cp-log-level-warn { color: var(--color-warning-text); }
.cp-log-level-error { color: var(--color-danger-text); }
.cp-log-level-off { color: var(--color-text-disabled); }
.cp-log-level-default { color: var(--color-text-secondary); }

.cp-counter-grid {
    display: grid;
    gap: var(--gap-xs);
    grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 768px) {
    .cp-counter-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
@media (min-width: 1024px) {
    .cp-counter-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}
.cp-counter-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.cp-counter-val {
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin-left: var(--gap-xs);
}

.cp-empty-inline {
    text-align: center;
    padding: var(--gap-xs) 0;
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}

.cp-toggle-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}
.cp-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 44px;
    height: 24px;
    border-radius: var(--radius-full);
    transition: background-color var(--duration-fast);
}
.cp-switch:focus {
    outline: none;
}
.cp-switch:focus-visible {
    box-shadow: var(--state-selected-ring);
}
.cp-switch--on {
    background-color: var(--color-success);
}
.cp-switch--off {
    background-color: var(--color-surface-4);
}
.cp-switch--danger-on {
    background-color: var(--color-danger);
}
.cp-switch-knob {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background-color: var(--color-text-primary);
    transition: transform var(--duration-fast);
}
.cp-switch-knob--on {
    transform: translateX(24px);
}
.cp-switch-knob--off {
    transform: translateX(4px);
}

.cp-toggle-label {
    font-size: var(--type-body);
    font-family: var(--font-mono);
}
.cp-text-on { color: var(--color-success-text); }
.cp-text-off { color: var(--color-text-disabled); }
.cp-text-warning { color: var(--color-warning-text); }
.cp-text-danger { color: var(--color-danger-text); }

.cp-tele-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--gap-sm);
}
.cp-tile {
    padding: var(--gap-sm);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-lg);
}
.cp-tile-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}
.cp-tile-value {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.cp-badge-diagnostic {
    padding: var(--space-0-5) var(--gap-xs);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-radius: var(--radius-md);
    background-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
    color: var(--color-danger-text);
}

.cp-warning-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-danger);
    background-color: color-mix(in srgb, var(--color-danger) 8%, transparent);
}
.cp-warning-icon {
    color: var(--color-danger-text);
    font-size: var(--type-caption);
    margin-top: var(--space-0-5);
}
.cp-warning-text {
    font-size: var(--type-caption);
    color: var(--color-danger-text);
}

.cp-confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--gap-lg);
    background-color: var(--color-overlay);
}
.cp-confirm-dialog {
    width: min(520px, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-lg);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    box-shadow: var(--shadow-lg);
}
.cp-confirm-label {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
}
.cp-confirm-input {
    width: 100%;
    padding: var(--gap-xs) var(--gap-sm);
    font-size: var(--type-body);
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
}
.cp-confirm-input:focus {
    outline: none;
    border-color: var(--color-danger);
}
.cp-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
</style>
