<template>
    <PageTemplate
        title="Logs"
        :tabs="monitoringTabs"
        back="/monitoring/investigate"
        active-path="/monitoring/investigate"
        fill
        searchable
        search-placeholder="Search logs…"
        v-model:search="searchQuery"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        @filter-click="filterModalVisible = true"
    >
        <template #actions>
            <Button
                type="blue-hollow"
                size="sm"
                @click="copyLogs"
            >
                {{ copyLabel }}
            </Button>
            <Button type="blue-hollow" size="sm" @click="downloadLogs">Download</Button>
            <Button type="blue-hollow" size="sm" @click="logStore.clearLogs()">Clear</Button>
            <Button
                :type="autoScroll ? 'blue' : 'blue-hollow'"
                size="sm"
                @click="toggleAutoScroll"
            >
                Auto-Scroll {{ autoScroll ? 'ON' : 'OFF' }}
            </Button>
        </template>

        <ErrorBoundary>
                <!-- Search match count -->
                <div
                    v-if="searchQuery"
                    class="logs-match-row"
                >
                    {{ displayedLogs.length }} matches for "{{ searchQuery }}"
                </div>

                <!-- Pinned logs -->
                <div v-if="pinnedLogs.length > 0" class="logs-pinned-bar">
                    <div class="logs-pinned-bar__head">
                        <span class="logs-count">Pinned ({{ pinnedLogs.length }})</span>
                        <button type="button" class="logs-clear-pins" @click="logStore.clearPins()">Clear pins</button>
                    </div>
                    <div
                        v-for="log in pinnedLogs"
                        :key="log.ts"
                        class="logs-line"
                        :class="logBorderColor(log.level)"
                    >
                        <span :style="{ color: log.color || 'white' }">{{ log.coloredPart }}</span>
                        <span class="logs-message-text"> - {{ log.message }}</span>
                    </div>
                </div>

                <!-- Log output -->
                <div ref="logContainer" class="logs-output">
                    <EmptyBlock v-if="displayedLogs.length === 0 && !searchQuery">
                        <template #icon>
                            <i class="fas fa-scroll" />
                        </template>
                        <p class="dp-empty-title">No logs yet</p>
                        <p class="dp-empty-sub">Logs will appear here as the system runs.</p>
                    </EmptyBlock>
                    <EmptyBlock v-else-if="displayedLogs.length === 0 && searchQuery">
                        <template #icon>
                            <i class="fas fa-magnifying-glass" />
                        </template>
                        <p class="dp-empty-title">No matches</p>
                        <p class="dp-empty-sub">No log lines match "{{ searchQuery }}".</p>
                    </EmptyBlock>
                    <div v-else class="logs-output__list">
                        <div
                            v-for="(log, index) in displayedLogs"
                            :key="index"
                            class="group logs-line"
                            :class="logBorderColor(log.level)"
                        >
                            <button
                                type="button"
                                class="opacity-0 group-hover:opacity-100 logs-pin-btn"
                                :aria-label="logStore.isPinned(log.ts) ? 'Unpin log entry' : 'Pin log entry'"
                                @click="logStore.togglePin(log.ts)"
                            >
                                {{ logStore.isPinned(log.ts) ? '&#x25C6;' : '&#x25C7;' }}
                            </button>
                            <div class="logs-line__body">
                                <span :style="{ color: log.color || 'white' }">{{ log.coloredPart }}</span>
                                <span class="logs-message-text"> - {{ log.message }}</span>
                            </div>
                        </div>
                    </div>
                </div>
        </ErrorBoundary>

        <template #modals>
            <FilterModal
                :visible="filterModalVisible"
                :sections="filterSections"
                :initial-state="modalState"
                :match-count="displayedLogs.length"
                match-label="logs"
                title="Log Filters"
                @close="filterModalVisible = false"
                @apply-generic="applyFilterState"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef, 
    computed,
    inject,
    nextTick,
    onMounted,
    onUnmounted,
    ref,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {registerShortcut} from '@/config/shortcuts';
import {useLogStore} from '@/stores/console';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const logStore = useLogStore();
const logContainer = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const LEVEL_OPTIONS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

// Time scope window (ms). 0 = "All time" — show every buffered log line.
const TIME_SCOPE_OPTIONS = [
    {key: 'all', label: 'All time', windowMs: 0},
    {key: '5m', label: 'Last 5 min', windowMs: 5 * 60 * 1000},
    {key: '15m', label: 'Last 15 min', windowMs: 15 * 60 * 1000},
    {key: '1h', label: 'Last hour', windowMs: 60 * 60 * 1000},
    {key: '6h', label: 'Last 6 hours', windowMs: 6 * 60 * 60 * 1000}
] as const;
type TimeScopeKey = (typeof TIME_SCOPE_OPTIONS)[number]['key'];

// State
const searchQuery = ref('');
const autoScroll = ref(true);
const copyLabel = ref('Copy');
const filterModalVisible = ref(false);
const timeScope = ref<TimeScopeKey>('all');
let copyTimer: ReturnType<typeof setTimeout> | undefined;

// "Now" tick — refreshed on a coarse interval so the time-scope filter slides
// forward without rebuilding on every log line. 5s is plenty for a UI cutoff.
const nowTick = ref(Date.now());
let nowTickInterval: ReturnType<typeof setInterval> | undefined;

const filterSections = computed<FilterSection[]>(() => {
    const sections: FilterSection[] = [
        {
            key: 'level',
            label: 'Log Level',
            icon: 'fa-layer-group',
            singleSelect: true,
            options: LEVEL_OPTIONS.map((l) => ({key: l, label: l}))
        },
        {
            key: 'timeScope',
            label: 'Time scope',
            icon: 'fa-clock',
            singleSelect: true,
            options: TIME_SCOPE_OPTIONS.map((t) => ({key: t.key, label: t.label}))
        }
    ];
    if (logStore.knownCategories.length) {
        sections.push({
            key: 'categories',
            label: 'Categories',
            icon: 'fa-tag',
            searchable: true,
            options: logStore.knownCategories.map((c) => ({key: c, label: c}))
        });
    }
    return sections;
});

const modalState = computed<FilterState>(() => ({
    level: [logStore.filter],
    timeScope: [timeScope.value],
    categories: Array.from(logStore.activeCategories)
}));

function applyFilterState(state: FilterState) {
    const level = state.level?.[0];
    if (level) logStore.setFilter(level as (typeof LEVEL_OPTIONS)[number]);
    const scope = state.timeScope?.[0];
    if (scope) timeScope.value = scope as TimeScopeKey;
    const next = new Set(state.categories ?? []);
    for (const c of Array.from(logStore.activeCategories)) {
        if (!next.has(c)) logStore.toggleCategory(c);
    }
    for (const c of next) {
        if (!logStore.activeCategories.has(c)) logStore.toggleCategory(c);
    }
    filterModalVisible.value = false;
}

const activeFilterCount = computed(() => {
    let n = 0;
    if (logStore.filter !== 'ALL') n++;
    if (timeScope.value !== 'all') n++;
    if (logStore.activeCategories.size > 0) n++;
    return n;
});

// Search + time-scope filter applied on top of the store's level/category filter.
const displayedLogs = computed(() => {
    let logs = logStore.filteredLogs;

    const scope = TIME_SCOPE_OPTIONS.find((t) => t.key === timeScope.value);
    if (scope && scope.windowMs > 0) {
        const cutoff = nowTick.value - scope.windowMs;
        logs = logs.filter((l) => {
            const ts =
                typeof l.ts === 'number' ? l.ts : new Date(l.ts).getTime();
            return ts >= cutoff;
        });
    }

    if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        logs = logs.filter(
            (l) =>
                l.coloredPart.toLowerCase().includes(q) ||
                l.message.toLowerCase().includes(q)
        );
    }
    return logs;
});

// Auto-scroll
function toggleAutoScroll() {
    autoScroll.value = !autoScroll.value;
}

watch(
    () => logStore.filteredLogs.length,
    () => {
        if (!autoScroll.value) return;
        requestAnimationFrame(() => {
            if (logContainer.value) {
                logContainer.value.scrollTop = logContainer.value.scrollHeight;
            }
        });
    }
);

// Download logs
function downloadLogs() {
    const text = logStore.formatLogsForExport(displayedLogs.value);
    const blob = new Blob([text], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// Copy logs
async function copyLogs() {
    const text = logStore.formatLogsForExport(displayedLogs.value);
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        copyLabel.value = 'Copied!';
    } catch {
        copyLabel.value = 'Failed';
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
        copyLabel.value = 'Copy';
    }, 1500);
}

// Log border color
function logBorderColor(level: string): string {
    switch (level) {
        case 'ERROR':
        case 'FATAL':
            return 'logs-border-error';
        case 'WARN':
            return 'logs-border-warn';
        case 'DEBUG':
            return 'logs-border-debug';
        default:
            return 'border-transparent';
    }
}

// Pinned logs
const pinnedLogs = computed(() => {
    return logStore.logs.filter((l) => logStore.isPinned(l.ts));
});

const unregShortcuts: Array<() => void> = [];

onMounted(() => {
    // Slide the time-scope window forward without churning on every log line.
    nowTickInterval = setInterval(() => {
        nowTick.value = Date.now();
    }, 5000);
    unregShortcuts.push(
        registerShortcut({
            id: 'logs.focus',
            description: 'Focus log search',
            section: 'Monitoring · Logs',
            handler: (e) => {
                e.preventDefault();
                searchInput.value?.focus();
            }
        }),
        registerShortcut({
            id: 'logs.clear',
            description: 'Clear log buffer',
            section: 'Monitoring · Logs',
            handler: (e) => {
                e.preventDefault();
                logStore.clearLogs();
            }
        }),
        registerShortcut({
            id: 'logs.clear-search',
            description: 'Clear search & blur',
            section: 'Monitoring · Logs',
            allowInInput: true,
            when: () =>
                !!searchQuery.value ||
                document.activeElement === searchInput.value,
            handler: () => {
                searchQuery.value = '';
                searchInput.value?.blur();
            }
        })
    );
});
onUnmounted(() => {
    for (const u of unregShortcuts) u();
    clearTimeout(copyTimer);
    if (nowTickInterval) clearInterval(nowTickInterval);
});
</script>

<style scoped>
/* GlassShell (provided by PageTemplate with fill) is flex-column; ErrorBoundary
 * is transparent so .logs-output grows inside the glass surface. */

/* -- Header chips -- */
.logs-count {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-disabled);
    align-self: center;
}

/* -- Match-count row when searching -- */
.logs-match-row {
    padding: var(--gap-xs) var(--gap-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
}

/* -- Pinned section -- */
.logs-pinned-bar {
    background: var(--glass-1-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    padding: var(--gap-xs) var(--gap-sm);
    margin-bottom: var(--gap-sm);
}
.logs-pinned-bar__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--gap-xs);
}
.logs-clear-pins {
    background: none;
    border: none;
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.logs-clear-pins:hover {
    color: var(--color-text-primary);
}

/* -- Log output -- inner scroll viewport inside the GlassShell. */
.logs-output {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    font-family: var(--font-mono);
}
.logs-output__list {
    padding: var(--gap-sm);
    font-size: var(--type-caption);
    white-space: pre-wrap;
}
.logs-line {
    border-left: 2px solid transparent;
    padding-left: var(--gap-xs);
    display: flex;
    align-items: flex-start;
    gap: var(--gap-xs);
}
.logs-line__body {
    flex: 1;
    min-width: 0;
}
.logs-message-text { color: var(--color-text-primary); }
.logs-pin-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    margin-top: var(--space-0-5);
    font-size: var(--type-caption);
}
.logs-pin-btn:hover { color: var(--color-text-primary); }

/* -- Log border levels -- */
.logs-border-error { border-left-color: var(--color-danger); }
.logs-border-warn { border-left-color: var(--color-warning); }
.logs-border-debug { border-left-color: var(--color-border-default); }
</style>
