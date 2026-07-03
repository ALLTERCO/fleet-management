import {getLogger} from 'log4js';
import * as Observability from './Observability';

const logger = getLogger();

// Non-fatal: a stray rejection is usually a transient blip; crashing would
// turn it into a crash loop.
export function handleUnhandledRejection(
    reason: unknown,
    promise: unknown
): void {
    logger.error('unhandledRejection', reason, promise);
    Observability.incrementCounter('process_unhandled_rejection_total');
}

// Fatal: an uncaught exception leaves the process in an undefined state.
// onFatal is injected so the handler stays testable.
export function makeUncaughtExceptionHandler(
    onFatal: () => void
): (reason: unknown, origin: unknown) => void {
    return (reason, origin) => {
        logger.error('uncaughtException', reason, origin);
        Observability.incrementCounter('process_uncaught_exception_total');
        onFatal();
    };
}
