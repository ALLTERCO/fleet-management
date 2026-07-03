import * as log4js from 'log4js';
import * as Observability from './Observability';
import * as postgres from './PostgresProvider';

const logger = log4js.getLogger('postgresTx');

interface TxHandle {
    begin(): Promise<number>;
    end(id: number, query: string): Promise<number>;
}

// Hook context passed to the transaction body. Use onCommit to schedule
// work that must NOT run until the COMMIT succeeds (cache invalidation,
// outbox enqueue, etc.). Discarded on rollback.
export interface PostgresTxContext {
    readonly txId: number;
    onCommit(cb: () => void | Promise<void>): void;
}

// Backward-compatible: callers that only need txId keep their signature.
export async function withPostgresTransaction<T>(
    fn: (txId: number, ctx: PostgresTxContext) => Promise<T>
): Promise<T> {
    const tx = (await postgres.callMethod('tx', {})) as TxHandle;
    const txId = await tx.begin();
    const hooks: Array<() => void | Promise<void>> = [];
    const ctx: PostgresTxContext = {
        txId,
        onCommit(cb) {
            hooks.push(cb);
        }
    };

    let committed = false;
    try {
        const result = await fn(txId, ctx);
        await tx.end(txId, 'COMMIT');
        committed = true;
        await runCommitHooks(hooks);
        return result;
    } catch (err) {
        if (!committed) {
            try {
                await tx.end(txId, 'ROLLBACK');
            } catch {
                // Preserve the original error if rollback also fails.
            }
        }
        throw err;
    }
}

// Hooks run sequentially after a successful COMMIT. Failures cannot
// unwind the commit, so log + count instead of propagating.
async function runCommitHooks(
    hooks: Array<() => void | Promise<void>>
): Promise<void> {
    for (const hook of hooks) {
        try {
            await hook();
        } catch (err) {
            Observability.incrementCounter('postgres_tx_commit_hook_failed');
            logger.error(
                'post-commit hook failed: %s',
                err instanceof Error ? err.message : String(err)
            );
        }
    }
}
