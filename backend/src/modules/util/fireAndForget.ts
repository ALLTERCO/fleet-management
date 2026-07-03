// Swallowed-error boundary. fireAndForget = no await; bestEffort = await.
// Both log at debug + bump a labeled counter.

import * as log4js from 'log4js';
import * as Observability from '../Observability';

const logger = log4js.getLogger('fireAndForget');

export function fireAndForget(label: string, work: Promise<unknown>): void {
    void work.catch((err) => {
        Observability.incrementLabeledCounter(
            'background_signal_failed_total',
            {label}
        );
        logger.debug(
            'background signal %s failed: %s',
            label,
            err instanceof Error ? err.message : String(err)
        );
    });
}

export async function bestEffort(
    label: string,
    work: Promise<unknown>
): Promise<void> {
    try {
        await work;
    } catch (err) {
        Observability.incrementLabeledCounter('best_effort_failed_total', {
            label
        });
        logger.debug(
            'best-effort %s failed: %s',
            label,
            err instanceof Error ? err.message : String(err)
        );
    }
}

// Sync variant for cleanup / close() calls. Same observability shape.
export function bestEffortSync(label: string, work: () => void): void {
    try {
        work();
    } catch (err) {
        Observability.incrementLabeledCounter('best_effort_failed_total', {
            label
        });
        logger.debug(
            'best-effort %s failed: %s',
            label,
            err instanceof Error ? err.message : String(err)
        );
    }
}
