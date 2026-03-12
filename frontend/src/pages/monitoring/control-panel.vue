<template>
    <div class="space-y-4 p-2">
        <h2 class="sr-only">Control Panel</h2>
        <!-- Observability Level (controls BOTH backend + frontend) -->
        <BasicBlock darker>
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-satellite-dish cp-icon-primary" />
                        <h3 class="font-semibold text-sm cp-block-title">Observability Level</h3>
                    </div>
                    <button
                        class="px-3 py-1 text-xs font-mono rounded cp-secondary-btn transition-colors"
                        @click="exportReport"
                    >
                        <i class="fa-solid fa-file-export mr-1" />Export Debug Report
                    </button>
                </div>
                <p class="text-xs cp-hint-text">
                    Controls what metrics are collected (backend) and displayed (frontend). Higher levels add more detail but increase overhead.
                </p>
                <div class="flex flex-wrap gap-2">
                    <button
                        v-for="(desc, i) in obsLevelDescriptions"
                        :key="i"
                        class="flex-1 min-w-[140px] p-3 rounded-lg border transition-colors text-left"
                        :class="store.obsLevel === i
                            ? levelActiveClass(i)
                            : 'cp-level-btn-inactive'"
                        @click="store.changeLevel(i as ObsLevel)"
                    >
                        <div class="text-sm font-mono font-semibold">{{ OBS_LEVEL_LABELS[i] }}</div>
                        <div class="text-xs mt-1 opacity-75">{{ desc }}</div>
                    </button>
                </div>
            </div>
        </BasicBlock>

        <!-- Backend Log Levels -->
        <BasicBlock darker>
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-scroll cp-icon-warning" />
                        <h3 class="font-semibold text-sm cp-block-title">Backend Log Levels</h3>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs cp-hint-text">Set All:</span>
                        <select
                            aria-label="Set all log levels"
                            class="cp-select rounded px-2 py-1 text-xs font-mono focus:outline-none"
                            @change="onSetAll($event)"
                        >
                            <option value="" disabled selected>—</option>
                            <option v-for="lvl in LOG_LEVELS" :key="lvl" :value="lvl">{{ lvl }}</option>
                        </select>
                    </div>
                </div>
                <p class="text-xs cp-hint-text">
                    Change log verbosity per backend module at runtime. Changes take effect immediately but do not persist across restarts.
                </p>
                <div v-if="Object.keys(store.logLevels).length === 0" class="text-xs cp-hint-text py-4 text-center">
                    <button
                        class="px-4 py-2 text-sm font-mono rounded cp-secondary-btn transition-colors"
                        @click="store.fetchLogLevels()"
                    >
                        Load Log Levels
                    </button>
                </div>
                <div v-else class="space-y-3">
                    <div v-for="group in groupedLogLevels" :key="group.name">
                        <button
                            class="flex items-center gap-2 w-full text-left py-1 hover:cursor-pointer"
                            @click="toggleGroup(group.name)"
                        >
                            <i
                                class="fas fa-chevron-right text-2xs transition-transform cp-hint-text"
                                :class="{ 'rotate-90': expandedGroups[group.name] }"
                            />
                            <i :class="group.icon" class="text-xs" :style="{ color: group.color }" />
                            <span class="text-xs font-semibold cp-block-title">{{ group.name }}</span>
                            <span class="text-2xs cp-hint-text">({{ group.entries.length }})</span>
                        </button>
                        <div v-if="expandedGroups[group.name]" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-1 ml-5">
                            <div
                                v-for="[category, level] in group.entries"
                                :key="category"
                                class="flex items-center justify-between gap-2 p-2 cp-log-row rounded"
                            >
                                <span class="text-xs font-mono cp-log-category truncate" :title="category">{{ category }}</span>
                                <select
                                    :aria-label="`Log level for ${category}`"
                                    class="cp-select-sm rounded px-2 py-0.5 text-xs font-mono min-w-[70px] focus:outline-none"
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

        <!-- Interaction Telemetry (Tier 2+) -->
        <BasicBlock v-if="store.obsLevel >= 2" darker>
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-chart-bar cp-icon-primary" />
                        <h3 class="font-semibold text-sm cp-block-title">Interaction Telemetry</h3>
                    </div>
                    <span class="text-xs cp-hint-text">{{ interactionsList.length }} events tracked</span>
                </div>
                <p class="text-xs cp-hint-text">
                    Counts of user interactions since page load. Included in debug report exports.
                </p>
                <div v-if="Object.keys(interactionCountsSnapshot).length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    <div
                        v-for="[key, count] in sortedInteractionCounts"
                        :key="key"
                        class="flex items-center justify-between p-2 cp-log-row rounded text-xs font-mono"
                    >
                        <span class="cp-log-category truncate" :title="key">{{ key }}</span>
                        <span class="font-semibold cp-block-title ml-2">{{ count }}</span>
                    </div>
                </div>
                <div v-else class="text-xs cp-hint-text py-2 text-center">
                    No interactions recorded yet.
                </div>
            </div>
        </BasicBlock>

        <!-- Frontend Debug Mode -->
        <BasicBlock darker>
            <div class="space-y-3">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-bug cp-icon-success" />
                    <h3 class="font-semibold text-sm cp-block-title">Frontend Debug Mode</h3>
                </div>
                <p class="text-xs cp-hint-text">
                    Enables verbose console.log output in browser DevTools. Independent of observability level. Persists via localStorage.
                </p>
                <div class="flex items-center gap-3">
                    <button
                        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                        :class="store.frontendDebug ? 'cp-toggle-on' : 'cp-toggle-off'"
                        @click="store.toggleFrontendDebug(!store.frontendDebug)"
                    >
                        <span
                            class="inline-block h-4 w-4 rounded-full cp-toggle-knob transition-transform"
                            :class="store.frontendDebug ? 'translate-x-6' : 'translate-x-1'"
                        />
                    </button>
                    <span class="text-sm font-mono" :class="store.frontendDebug ? 'cp-debug-on-text' : 'cp-debug-off-text'">
                        {{ store.frontendDebug ? 'ON' : 'OFF' }}
                    </span>
                </div>
            </div>
        </BasicBlock>

        <!-- WS Patch Telemetry -->
        <BasicBlock darker>
            <div class="space-y-3">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-wave-square cp-icon-accent" />
                    <h3 class="font-semibold text-sm cp-block-title">WS Patch Telemetry</h3>
                </div>
                <p class="text-xs cp-hint-text">
                    Tracks peak patch buffer depth, deferred-frame count, and RAF apply time per frame.
                    Adds minor overhead per WebSocket event. Persists via localStorage.
                </p>
                <div class="flex items-center gap-3">
                    <button
                        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                        :class="store.wsTelemetryEnabled ? 'cp-toggle-on' : 'cp-toggle-off'"
                        @click="store.toggleWsTelemetry(!store.wsTelemetryEnabled)"
                    >
                        <span
                            class="inline-block h-4 w-4 rounded-full cp-toggle-knob transition-transform"
                            :class="store.wsTelemetryEnabled ? 'translate-x-6' : 'translate-x-1'"
                        />
                    </button>
                    <span class="text-sm font-mono" :class="store.wsTelemetryEnabled ? 'cp-debug-on-text' : 'cp-debug-off-text'">
                        {{ store.wsTelemetryEnabled ? 'ON' : 'OFF' }}
                    </span>
                </div>
                <div v-if="store.wsTelemetryEnabled" class="grid grid-cols-3 gap-3">
                    <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                        <div class="text-xs text-[var(--color-text-disabled)] mb-1">Buffer Peak</div>
                        <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                            {{ store.wsTelemetryData.patchBufferMaxDepth }}
                        </span>
                    </div>
                    <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                        <div class="text-xs text-[var(--color-text-disabled)] mb-1">Deferred Frames</div>
                        <span class="text-sm font-mono font-semibold" :class="store.wsTelemetryData.droppedFrameCount > 0 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                            {{ store.wsTelemetryData.droppedFrameCount }}
                        </span>
                    </div>
                    <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                        <div class="text-xs text-[var(--color-text-disabled)] mb-1">RAF Apply Max</div>
                        <span class="text-sm font-mono font-semibold" :class="store.wsTelemetryData.rafFrameTimeMaxMs > 16 ? 'text-[var(--color-danger-text)]' : store.wsTelemetryData.rafFrameTimeMaxMs > 8 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                            {{ store.wsTelemetryData.rafFrameTimeMaxMs }}ms
                        </span>
                    </div>
                </div>
            </div>
        </BasicBlock>

        <!-- Diagnostic: Disable DB Writes -->
        <BasicBlock darker>
            <div class="space-y-3">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-database cp-icon-danger" />
                    <h3 class="font-semibold text-sm cp-block-title">Disable Hot-Path DB Writes</h3>
                    <span class="text-xs font-mono px-1.5 py-0.5 rounded cp-badge-diagnostic">DIAGNOSTIC</span>
                </div>
                <p class="text-xs cp-hint-text">
                    Suppresses status flushes, EM stats writes, device state persists, and audit log writes.
                    WebSocket connections, event broadcasting, in-memory state, and RPC commands continue normally.
                    Use for A/B testing whether DB writes are the performance bottleneck.
                    <strong class="text-[var(--color-danger-text)]">Resets on restart.</strong>
                </p>
                <div class="flex items-center gap-3">
                    <button
                        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                        :class="store.dbWritesDisabled ? 'cp-toggle-danger-on' : 'cp-toggle-off'"
                        :disabled="dbWritesLoading"
                        @click="toggleDbWrites"
                    >
                        <span
                            class="inline-block h-4 w-4 rounded-full cp-toggle-knob transition-transform"
                            :class="store.dbWritesDisabled ? 'translate-x-6' : 'translate-x-1'"
                        />
                    </button>
                    <span class="text-sm font-mono" :class="store.dbWritesDisabled ? 'text-[var(--color-danger-text)]' : 'cp-debug-off-text'">
                        {{ store.dbWritesDisabled ? 'WRITES DISABLED' : 'NORMAL' }}
                    </span>
                </div>
                <div v-if="store.dbWritesDisabled" class="flex items-start gap-2 p-2 rounded border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]">
                    <i class="fa-solid fa-triangle-exclamation text-[var(--color-danger-text)] text-xs mt-0.5" />
                    <span class="text-xs text-[var(--color-danger-text)]">
                        DB writes are disabled — status history, EM data, and audit logs are NOT being recorded.
                        Queues are being drained to prevent memory growth.
                    </span>
                </div>
            </div>
        </BasicBlock>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import apiClient from '@/helpers/axios';
import {useLogStore} from '@/stores/console';
import {useMonitoringStore} from '@/stores/monitoring';
import {
    fetchDebugReport,
    getInteractionCounts,
    getInteractions,
    getPendingRpcCount,
    getRpcTimings,
    getWsMessagesPerSec,
    OBS_LEVEL_LABELS,
    type ObsLevel
} from '@/tools/observability';

const store = useMonitoringStore();
const logStore = useLogStore();

/* ---- Log level category grouping ---- */
const MODULE_CATEGORIES: Record<string, string> = {
    // Core — main app, config, plugins, auth
    default: 'Core',
    config: 'Core',
    audit: 'Core',
    'frontend-builder': 'Core',
    'node-red-config': 'Core',
    'event-model': 'Core',
    user: 'Core',
    'Plugin Loader': 'Core',
    'plugin-loader': 'Core',
    // Device — device management, firmware, backups, sensors
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
    // Network — websocket, HTTP, connections
    'ws-server': 'Network',
    'shelly-ws': 'Network',
    'client-ws': 'Network',
    'local-ws': 'Network',
    'ws-transport': 'Network',
    'ws-upgrade': 'Network',
    'message-handler': 'Network',
    'device-gui-proxy': 'Network',
    web: 'Network',
    api: 'Network',
    'grafana-proxy': 'Network',
    // Storage — database, persistence
    postgres: 'Storage',
    // Monitoring — metrics, telemetry, observability
    Observability: 'Monitoring'
};

const CATEGORY_META: Record<
    string,
    {icon: string; color: string; order: number}
> = {
    Core: {icon: 'fas fa-cog', color: 'var(--color-primary-text)', order: 0},
    Device: {
        icon: 'fas fa-microchip',
        color: 'var(--color-success-text)',
        order: 1
    },
    Network: {
        icon: 'fas fa-network-wired',
        color: 'var(--color-warning-text)',
        order: 2
    },
    Storage: {
        icon: 'fas fa-database',
        color: 'var(--color-accent-text)',
        order: 3
    },
    Monitoring: {
        icon: 'fas fa-chart-line',
        color: 'var(--color-primary-text)',
        order: 4
    },
    Other: {
        icon: 'fas fa-ellipsis',
        color: 'var(--color-text-disabled)',
        order: 5
    }
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
    // Sort entries within each group
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
        case 0:
            return 'cp-level-active-off';
        case 1:
            return 'cp-level-active-light';
        case 2:
            return 'cp-level-active-medium';
        case 3:
            return 'cp-level-active-heavy';
        default:
            return 'cp-level-active-off';
    }
}

function logLevelColor(level: string): string {
    switch (level.toUpperCase()) {
        case 'ALL':
        case 'TRACE':
        case 'DEBUG':
            return 'cp-log-level-debug';
        case 'INFO':
            return 'cp-log-level-info';
        case 'WARN':
            return 'cp-log-level-warn';
        case 'ERROR':
        case 'FATAL':
            return 'cp-log-level-error';
        case 'OFF':
            return 'cp-log-level-off';
        default:
            return 'cp-log-level-default';
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

// Interaction telemetry
const interactionsList = computed(() => [...getInteractions()]);
const interactionCountsSnapshot = computed(() => ({...getInteractionCounts()}));
const sortedInteractionCounts = computed(() =>
    Object.entries(interactionCountsSnapshot.value).sort((a, b) => b[1] - a[1])
);

const dbWritesLoading = ref(false);

onMounted(async () => {
    try {
        const {data} = await apiClient.get('/health/db-writes');
        store.dbWritesDisabled = data.dbWritesDisabled ?? false;
    } catch { /* endpoint may not exist yet */ }
});

async function toggleDbWrites() {
    dbWritesLoading.value = true;
    try {
        const {data} = await apiClient.post('/health/db-writes', {
            disabled: !store.dbWritesDisabled
        });
        store.dbWritesDisabled = data.dbWritesDisabled;
    } finally {
        dbWritesLoading.value = false;
    }
}

// Load log levels on mount
store.fetchLogLevels();
</script>

<style scoped>
/* -- Block titles & hints -- */
.cp-block-title { color: var(--color-text-secondary); }
.cp-hint-text { color: var(--color-text-disabled); }

/* -- Icons -- */
.cp-icon-primary { color: var(--color-primary-text); }
.cp-icon-warning { color: var(--color-warning-text); }
.cp-icon-success { color: var(--color-success-text); }
.cp-icon-accent { color: var(--color-accent-text); }

/* -- Secondary button (export, load) -- */
.cp-secondary-btn {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.cp-secondary-btn:hover {
    background-color: var(--color-surface-4);
}

/* -- Level selector inactive state -- */
.cp-level-btn-inactive {
    background-color: var(--color-surface-2);
    border-color: var(--color-border-default);
    color: var(--color-text-tertiary);
}
.cp-level-btn-inactive:hover {
    background-color: var(--color-surface-3);
    border-color: var(--color-border-strong);
}

/* -- Level selector active states -- */
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
    color: var(--primitive-amber-100, #fef3c7);
}
.cp-level-active-heavy {
    background-color: color-mix(in srgb, var(--color-danger-subtle) 40%, transparent);
    border-color: var(--color-danger);
    color: var(--primitive-red-300);
}

/* -- Select dropdowns -- */
.cp-select {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    color: var(--color-text-secondary);
}
.cp-select:focus { border-color: var(--color-border-focus); }

.cp-select-sm {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
}
.cp-select-sm:focus { border-color: var(--color-border-focus); }

/* -- Log level row -- */
.cp-log-row { background-color: var(--color-surface-1); }
.cp-log-category { color: var(--color-text-tertiary); }

/* -- Log level color classes -- */
.cp-log-level-debug { color: var(--color-primary-text); }
.cp-log-level-info { color: var(--color-success-text); }
.cp-log-level-warn { color: var(--color-warning-text); }
.cp-log-level-error { color: var(--color-danger-text); }
.cp-log-level-off { color: var(--color-text-disabled); }
.cp-log-level-default { color: var(--color-text-secondary); }

/* -- Debug toggle -- */
.cp-toggle-on { background-color: var(--color-success); }
.cp-toggle-off { background-color: var(--color-surface-4); }
.cp-debug-on-text { color: var(--color-success-text); }
.cp-debug-off-text { color: var(--color-text-disabled); }
.cp-toggle-knob { background-color: var(--color-text-primary); }

/* -- Danger / diagnostic toggle -- */
.cp-icon-danger { color: var(--color-danger-text); }
.cp-toggle-danger-on { background-color: var(--color-danger); }
.cp-badge-diagnostic {
    background-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
    color: var(--color-danger-text);
}
</style>
