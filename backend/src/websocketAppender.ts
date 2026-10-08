import {format} from 'node:util';
import type {AppenderModule, LoggingEvent} from 'log4js';
import {tuning} from './config/tuning';
import {truncateForDebugLog} from './modules/util/truncateForDebugLog';

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
/** Reported once per flush, never per drop. One report per drop is how a single
 *  Redis backpressure event turned into a log storm: the report is itself a log
 *  line, which lands back in this buffer. */
let droppedSinceFlush = 0;

function flushLogs() {
    flushTimer = null;
    if (logBuffer.length === 0 && droppedSinceFlush === 0) return;
    emitting = true;
    const batch = logBuffer.splice(0);
    if (droppedSinceFlush > 0) {
        batch.push({
            coloredPart: `${new Date().toISOString()} - WARN`,
            log:
                `websocket log buffer full: dropped ${droppedSinceFlush} oldest ` +
                `lines (cap ${tuning.ws.streamMaxlen}). stdout has them all.`,
            color: getLogColor('WARN'),
            category: 'websocket-appender'
        });
        droppedSinceFlush = 0;
    }
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

        // Bounded by the length the session stream is already trimmed to
        // (SessionEventStream.ts). Holding more than the stream will keep is waste
        // by definition, so this needs no second number and no new env var.
        // Oldest goes first: stdout and logging.audit_log are the durable record,
        // the websocket console is a live tail, and the newest lines are the ones
        // that explain a burst.
        while (logBuffer.length >= tuning.ws.streamMaxlen) {
            logBuffer.shift();
            droppedSinceFlush += 1;
        }
        logBuffer.push({
            coloredPart,
            // One observed line was 14,181 characters. Capped with the same value
            // the RPC error log already uses.
            log: truncateForDebugLog(message, tuning.ws.debugLogMaxBytes),
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
