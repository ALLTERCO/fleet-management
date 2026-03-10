import {defineStore} from 'pinia';
import {computed, ref} from 'vue';

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
const LEVEL_SEVERITY: Record<LogLevel, number> = {
    DEBUG: 0,
    MARK: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    FATAL: 5
};
const MAX_LOGS = 2000;

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
            ts: number;
        }[]
    >([]);
    const filter = ref<LogFilter>('ALL');

    const filteredLogs = computed(() => {
        if (filter.value === 'ALL') return logs.value;
        return logs.value.filter((log) => log.level === filter.value);
    });

    function addLog(coloredPart: string, message: string, color: string) {
        logs.value.push({
            coloredPart,
            message,
            color,
            level: parseLevel(coloredPart),
            ts: Date.now()
        });
        if (logs.value.length > MAX_LOGS) {
            logs.value.splice(0, logs.value.length - MAX_LOGS);
        }
    }

    function clearLogs() {
        logs.value = [];
    }

    function setFilter(level: LogFilter) {
        filter.value = level;
    }

    const pinnedLogTimestamps = ref<Set<number>>(new Set());

    function togglePin(ts: number) {
        if (pinnedLogTimestamps.value.has(ts)) {
            pinnedLogTimestamps.value.delete(ts);
        } else {
            pinnedLogTimestamps.value.add(ts);
        }
        pinnedLogTimestamps.value = new Set(pinnedLogTimestamps.value);
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
                return `[${time}] [${l.level}] ${l.coloredPart} - ${l.message}`;
            })
            .join('\n');
    }

    return {
        logs,
        filter,
        filteredLogs,
        pinnedLogTimestamps,
        addLog,
        clearLogs,
        setFilter,
        formatLogsForExport,
        togglePin,
        isPinned,
        clearPins
    } as const;
});
