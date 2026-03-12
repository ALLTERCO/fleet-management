<template>
    <div class="flex flex-col h-[calc(100vh-10rem)] lg:h-[calc(100vh-7rem)] w-full pb-2">
        <h2 class="sr-only">System Logs</h2>
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 px-4 py-2 logs-toolbar">
            <!-- Search input -->
            <input
                ref="searchInput"
                v-model="searchQuery"
                type="text"
                placeholder="Search logs..."
                aria-label="Search logs"
                class="px-3 py-1 text-xs font-mono rounded logs-search-input w-48 focus:outline-none"
            />

            <!-- Log level filters -->
            <button
                v-for="level in filterOptions"
                :key="level"
                class="px-3 py-1 text-xs font-mono rounded transition-colors"
                :class="logStore.filter === level
                    ? 'logs-filter-active'
                    : 'logs-filter-inactive'"
                @click="logStore.setFilter(level)"
            >
                {{ level }}
            </button>

            <div class="flex-1" />

            <!-- Log count -->
            <span class="text-xs logs-count font-mono">{{ displayedLogs.length }} logs</span>

            <!-- Action buttons -->
            <button
                class="px-3 py-1 text-xs font-mono rounded transition-colors"
                :class="copyLabel === 'Copied!'
                    ? 'logs-btn-success'
                    : 'logs-btn-default'"
                @click="copyLogs"
            >
                {{ copyLabel }}
            </button>
            <button
                class="px-3 py-1 text-xs font-mono rounded logs-btn-default transition-colors"
                @click="downloadLogs"
            >
                Download
            </button>
            <button
                class="px-3 py-1 text-xs font-mono rounded logs-btn-default transition-colors"
                @click="logStore.clearLogs()"
            >
                Clear
            </button>
            <button
                class="px-3 py-1 text-xs font-mono rounded transition-colors"
                :class="autoScroll
                    ? 'logs-btn-primary-active'
                    : 'logs-btn-default'"
                @click="toggleAutoScroll"
            >
                Auto-Scroll {{ autoScroll ? 'ON' : 'OFF' }}
            </button>
        </div>

        <!-- Search match count -->
        <div
            v-if="searchQuery"
            class="flex items-center gap-2 px-4 py-1 logs-toolbar text-xs font-mono logs-match-text"
        >
            {{ displayedLogs.length }} matches for "{{ searchQuery }}"
        </div>

        <!-- Pinned logs -->
        <div v-if="pinnedLogs.length > 0" class="logs-pinned-bar px-4 py-2">
            <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-mono logs-count">Pinned ({{ pinnedLogs.length }})</span>
                <button class="text-xs font-mono logs-clear-pins" @click="logStore.clearPins()">Clear pins</button>
            </div>
            <div v-for="log in pinnedLogs" :key="log.ts" class="text-xs md:text-sm font-mono border-l-2 pl-2" :class="logBorderColor(log.level)">
                <span :style="{ color: log.color || 'white' }">{{ log.coloredPart }}</span>
                <span class="logs-message-text"> - {{ log.message }}</span>
            </div>
        </div>

        <!-- Log output -->
        <div ref="logContainer" class="flex-1 logs-output overflow-auto">
            <div v-if="displayedLogs.length === 0 && !searchQuery" class="flex flex-col items-center justify-center h-full logs-empty-text">
                <i class="fas fa-scroll text-2xl mb-2 opacity-30" />
                <p class="text-sm">No logs yet</p>
                <p class="text-xs mt-1 opacity-60">Logs will appear here as the system runs</p>
            </div>
            <div v-else class="p-4 text-xs md:text-sm font-mono whitespace-pre-wrap">
                <div v-for="(log, index) in displayedLogs" :key="index"
                    class="group border-l-2 pl-2 flex items-start gap-1"
                    :class="logBorderColor(log.level)"
                >
                    <button
                        class="opacity-0 group-hover:opacity-100 logs-pin-btn text-xs flex-shrink-0 mt-0.5"
                        @click="logStore.togglePin(log.ts)"
                    >
                        {{ logStore.isPinned(log.ts) ? '&#x25C6;' : '&#x25C7;' }}
                    </button>
                    <div class="flex-1">
                        <span :style="{ color: log.color || 'white' }">{{ log.coloredPart }}</span>
                        <span class="logs-message-text"> - {{ log.message }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {useLogStore} from '@/stores/console';

const logStore = useLogStore();
const logContainer = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const filterOptions = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

// State
const searchQuery = ref('');
const autoScroll = ref(true);
const copyLabel = ref('Copy');

// Search filter
const displayedLogs = computed(() => {
    const logs = logStore.filteredLogs;
    if (!searchQuery.value) return logs;
    const q = searchQuery.value.toLowerCase();
    return logs.filter(
        (l) =>
            l.coloredPart.toLowerCase().includes(q) ||
            l.message.toLowerCase().includes(q)
    );
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
    setTimeout(() => {
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

// Keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'k') {
        e.preventDefault();
        searchInput.value?.focus();
    } else if (mod && e.key === 'l') {
        e.preventDefault();
        logStore.clearLogs();
    } else if (e.key === 'Escape') {
        searchQuery.value = '';
        searchInput.value?.blur();
    }
}

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<style scoped>
/* -- Toolbar -- */
.logs-toolbar {
    background-color: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
}

/* -- Search input -- */
.logs-search-input {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
}
.logs-search-input::placeholder { color: var(--color-text-disabled); }
.logs-search-input:focus { border-color: var(--color-text-disabled); }

/* -- Filter buttons -- */
.logs-filter-active {
    background-color: var(--color-surface-4);
    color: var(--color-text-primary);
}
.logs-filter-inactive {
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
}
.logs-filter-inactive:hover { background-color: var(--color-surface-3); }

/* -- Action buttons -- */
.logs-btn-default {
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
}
.logs-btn-default:hover { background-color: var(--color-surface-3); }

.logs-btn-success {
    background-color: var(--color-success-hover);
    color: var(--primitive-green-300);
}

.logs-btn-primary-active {
    background-color: var(--color-primary-hover);
    color: var(--primitive-blue-200);
}
.logs-btn-primary-active:hover { background-color: var(--color-primary); }

/* -- Counts & labels -- */
.logs-count { color: var(--color-text-disabled); }
.logs-match-text { color: var(--color-text-tertiary); }

/* -- Pinned section -- */
.logs-pinned-bar {
    background-color: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-default);
}
.logs-clear-pins { color: var(--color-border-strong); }
.logs-clear-pins:hover { color: var(--color-text-secondary); }

/* -- Log output -- */
.logs-output { background-color: var(--color-surface-0); }
.logs-message-text { color: var(--color-text-primary); }
.logs-pin-btn { color: var(--color-border-strong); }
.logs-pin-btn:hover { color: var(--color-text-secondary); }

/* -- Log border levels -- */
.logs-border-error { border-left-color: var(--color-danger); }
.logs-border-warn { border-left-color: var(--color-warning); }
.logs-border-debug { border-left-color: var(--color-border-default); }
.logs-empty-text { color: var(--color-text-disabled); }
</style>
