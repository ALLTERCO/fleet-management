import {format} from 'node:util';
import type {AppenderModule, LoggingEvent} from 'log4js';
import {emitConsoleLogBatch} from './modules/ShellyEvents';

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

type LogEntry = {coloredPart: string; log: string; color: string};
const logBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let emitting = false;

function flushLogs() {
    flushTimer = null;
    if (logBuffer.length === 0) return;
    emitting = true;
    try {
        const batch = logBuffer.splice(0);
        emitConsoleLogBatch(batch);
    } finally {
        emitting = false;
    }
}

function websocketAppender(): (loggingEvent: LoggingEvent) => void {
    return (loggingEvent: LoggingEvent) => {
        if (emitting) return;
        const coloredPart = `${loggingEvent.startTime.toISOString()} - ${loggingEvent.level.levelStr}`;
        const message = format(...loggingEvent.data);
        const logColor = getLogColor(loggingEvent.level.levelStr);

        logBuffer.push({coloredPart, log: message, color: logColor});
        if (!flushTimer) {
            flushTimer = setTimeout(flushLogs, 250);
        }
    };
}

const appender: AppenderModule = {
    configure: () => websocketAppender()
};

export default appender;
