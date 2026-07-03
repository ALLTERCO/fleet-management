import {format} from 'node:util';
import type {AppenderModule, LoggingEvent} from 'log4js';
import {tuning} from './config/tuning';

function getLogColor(level: string): string {
    switch (level) {
        case 'ERROR':
            return 'red';
        case 'WARN':
            return 'yellow';
        case 'INFO':
            return 'green';
        case 'DEBUG':
            return 'lightblue';
        case 'FATAL':
            return 'purple';
        case 'MARK':
            return 'grey';
        default:
            return 'white';
    }
}

type LogEntry = {
    coloredPart: string;
    log: string;
    color: string;
    category?: string;
};
const logBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let emitting = false;

function flushLogs() {
    flushTimer = null;
    if (logBuffer.length === 0) return;
    emitting = true;
    const batch = logBuffer.splice(0);
    void import('./modules/ShellyEvents.js')
        .then(({emitConsoleLogBatch}) => emitConsoleLogBatch(batch))
        // Silent on purpose — this IS the log appender; routing the
        // failure through log4js would recurse back into us.
        .catch(() => {})
        .finally(() => {
            emitting = false;
        });
}

function websocketAppender(): (loggingEvent: LoggingEvent) => void {
    return (loggingEvent: LoggingEvent) => {
        if (emitting) return;
        const coloredPart = `${loggingEvent.startTime.toISOString()} - ${loggingEvent.level.levelStr}`;
        const message = format(...loggingEvent.data);
        const logColor = getLogColor(loggingEvent.level.levelStr);

        logBuffer.push({
            coloredPart,
            log: message,
            color: logColor,
            category: loggingEvent.categoryName
        });
        if (!flushTimer) {
            flushTimer = setTimeout(flushLogs, tuning.ws.logFlushMs);
        }
    };
}

const appender: AppenderModule = {
    configure: () => websocketAppender()
};

export default appender;
