import * as log4js from 'log4js';
import {
    MCP_OPERATION_LEASE_SECONDS,
    MCP_OPERATION_MAINTENANCE_BATCH_SIZE,
    maintainOperationLeases,
    type OperationLifecycleStore,
    releaseOperationLeases
} from './operationStore';

const INTERVAL_MS = (MCP_OPERATION_LEASE_SECONDS * 1000) / 3;
const MAX_BATCHES_PER_TURN = 10;
const logger = log4js.getLogger('McpOperationRecovery');

interface RecoveryDependencies extends OperationLifecycleStore {
    schedule(callback: () => void, delayMs: number): () => void;
    onError(): void;
}

export function createOperationRecovery(deps: RecoveryDependencies) {
    let active = false;
    let pending: Promise<void> | undefined;
    let cancelTimer: (() => void) | undefined;
    let stopping: Promise<void> | undefined;

    async function maintain(): Promise<void> {
        let full = false;
        for (let batch = 0; batch < MAX_BATCHES_PER_TURN; batch++) {
            const result = await deps.maintain();
            full =
                result.moreActive ||
                [result.leasesRenewed, result.orphaned, result.purged].some(
                    (count) => count >= MCP_OPERATION_MAINTENANCE_BATCH_SIZE
                );
            if (!active || !full) break;
        }
        if (active) schedule(full ? 0 : INTERVAL_MS);
    }

    function schedule(delayMs: number): void {
        cancelTimer = deps.schedule(() => {
            cancelTimer = undefined;
            if (!active) return;
            pending = maintain().catch(() => {
                deps.onError();
                if (active) schedule(INTERVAL_MS);
            });
        }, delayMs);
    }

    async function start(): Promise<void> {
        if (stopping) await stopping;
        if (active) return pending;
        active = true;
        pending = maintain().catch((error: unknown) => {
            active = false;
            throw error;
        });
        return pending;
    }

    async function stop(): Promise<void> {
        if (stopping) return stopping;
        if (!active) return;
        active = false;
        cancelTimer?.();
        cancelTimer = undefined;
        stopping = (async () => {
            await pending?.catch(() => undefined);
            // Expiry recovers any remainder without holding shutdown indefinitely.
            for (let batch = 0; batch < MAX_BATCHES_PER_TURN; batch++) {
                if (
                    (await deps.release()) <
                    MCP_OPERATION_MAINTENANCE_BATCH_SIZE
                )
                    break;
            }
        })();
        try {
            await stopping;
        } finally {
            stopping = undefined;
        }
    }

    return {start, stop};
}

const recovery = createOperationRecovery({
    maintain: maintainOperationLeases,
    release: releaseOperationLeases,
    schedule(callback, delayMs) {
        const timer = setTimeout(callback, delayMs);
        timer.unref();
        return () => clearTimeout(timer);
    },
    onError() {
        logger.warn('MCP operation lease maintenance failed; retry scheduled');
    }
});

export const start = recovery.start;
export const stop = recovery.stop;
