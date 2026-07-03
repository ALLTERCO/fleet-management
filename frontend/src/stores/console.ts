import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {LOG_BUFFER_MAX, LOG_CATEGORY_MAX} from '@/constants';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'FATAL' | 'MARK';
type LogFilter = LogLevel | 'ALL';

const LOG_LEVELS: LogLevel[] = [
    'ERROR',
    'WARN',
    'INFO',
    'DEBUG',
    'FATAL',
    'MARK'
];

function parseLevel(coloredPart: string): LogLevel {
    for (const level of LOG_LEVELS) {
        if (coloredPart.includes(level)) return level;
    }
    return 'INFO';
}

export const useLogStore = defineStore('logStore', () => {
    const logs = ref<
        {
            coloredPart: string;
            message: string;
            color: string;
            level: LogLevel;
            category?: string;
            ts: number;
        }[]
    >([]);
    const filter = ref<LogFilter>('ALL');
    // Empty set = all categories allowed. Only filters when non-empty.
    const activeCategories = ref<Set<string>>(new Set());

    const knownCategories = computed(() => {
        const seen = new Set<string>();
        for (const l of logs.value) if (l.category) seen.add(l.category);
        return [...seen].sort().slice(0, LOG_CATEGORY_MAX);
    });

    const filteredLogs = computed(() => {
        let result = logs.value;
        if (filter.value !== 'ALL') {
            result = result.filter((log) => log.level === filter.value);
        }
        if (activeCategories.value.size > 0) {
            result = result.filter(
                (l) => l.category && activeCategories.value.has(l.category)
            );
        }
        return result;
    });

    function addLog(
        coloredPart: string,
        message: string,
        color: string,
        category?: string
    ) {
        logs.value.push({
            coloredPart,
            message,
            color,
            level: parseLevel(coloredPart),
            category,
            ts: Date.now()
        });
        if (logs.value.length > LOG_BUFFER_MAX) {
            logs.value.splice(0, logs.value.length - LOG_BUFFER_MAX);
        }
    }

    function clearLogs() {
        logs.value = [];
        pinnedLogTimestamps.value = new Set();
        // Without this, new logs after clear would be filtered against
        // categories that no longer exist in the buffer — silently hidden.
        activeCategories.value = new Set();
    }

    function setFilter(level: LogFilter) {
        filter.value = level;
    }

    function toggleCategory(cat: string) {
        const next = new Set(activeCategories.value);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        activeCategories.value = next;
    }

    function clearCategoryFilter() {
        activeCategories.value = new Set();
    }

    const pinnedLogTimestamps = ref<Set<number>>(new Set());

    function togglePin(ts: number) {
        const next = new Set(pinnedLogTimestamps.value);
        if (next.has(ts)) {
            next.delete(ts);
        } else {
            next.add(ts);
        }
        pinnedLogTimestamps.value = next;
    }

    function isPinned(ts: number): boolean {
        return pinnedLogTimestamps.value.has(ts);
    }

    function clearPins() {
        pinnedLogTimestamps.value = new Set();
    }

    function formatLogsForExport(logEntries: typeof logs.value): string {
        return logEntries
            .map((l) => {
                const d = new Date(l.ts);
                const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
                const cat = l.category ? ` [${l.category}]` : '';
                return `[${time}] [${l.level}]${cat} ${l.coloredPart} - ${l.message}`;
            })
            .join('\n');
    }

    return {
        logs,
        filter,
        filteredLogs,
        knownCategories,
        activeCategories,
        pinnedLogTimestamps,
        addLog,
        clearLogs,
        setFilter,
        toggleCategory,
        clearCategoryFilter,
        formatLogsForExport,
        togglePin,
        isPinned,
        clearPins
    } as const;
});
