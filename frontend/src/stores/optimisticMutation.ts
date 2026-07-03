import {UI_CONFIG} from '@/config/ui';

export class OptimisticMutationTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Optimistic mutation timed out after ${timeoutMs}ms`);
        this.name = 'OptimisticMutationTimeoutError';
    }
}

export interface OptimisticMutationOptions<Result, Snapshot = void> {
    snapshot?: () => Snapshot | Promise<Snapshot>;
    apply(snapshot: Snapshot | undefined): void | Promise<void>;
    commit(): Promise<Result>;
    rollback(snapshot: Snapshot | undefined): void | Promise<void>;
    reconcile?(
        result: Result,
        snapshot: Snapshot | undefined
    ): void | Promise<void>;
    onError?(
        error: unknown,
        snapshot: Snapshot | undefined
    ): void | Promise<void>;
    timeoutMs?: number;
}

export async function runOptimisticMutation<Result, Snapshot = void>(
    options: OptimisticMutationOptions<Result, Snapshot>
): Promise<Result> {
    const snapshot = readOptimisticSnapshot(options);
    if (isPromiseLike(snapshot)) {
        return runOptimisticMutationWithSnapshot(options, await snapshot);
    }

    return runOptimisticMutationWithSnapshot(options, snapshot);
}

async function runOptimisticMutationWithSnapshot<Result, Snapshot>(
    options: OptimisticMutationOptions<Result, Snapshot>,
    snapshot: Snapshot | undefined
): Promise<Result> {
    await options.apply(snapshot);

    try {
        const result = await commitWithTimeout(
            options.commit,
            mutationTimeoutMs(options)
        );
        await options.reconcile?.(result, snapshot);
        return result;
    } catch (err) {
        await options.rollback(snapshot);
        await options.onError?.(err, snapshot);
        throw err;
    }
}

function readOptimisticSnapshot<Snapshot>(
    options: OptimisticMutationOptions<unknown, Snapshot>
): Snapshot | Promise<Snapshot> | undefined {
    return options.snapshot?.();
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as Promise<T>).then === 'function'
    );
}

function mutationTimeoutMs(
    options: Pick<OptimisticMutationOptions<unknown, unknown>, 'timeoutMs'>
): number {
    return options.timeoutMs ?? UI_CONFIG.optimisticReaperMs;
}

function commitWithTimeout<Result>(
    commit: () => Promise<Result>,
    timeoutMs: number
): Promise<Result> {
    if (timeoutMs <= 0) {
        return commit();
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    return new Promise<Result>((resolve, reject) => {
        timeout = setTimeout(() => {
            timeout = undefined;
            reject(new OptimisticMutationTimeoutError(timeoutMs));
        }, timeoutMs);

        Promise.resolve()
            .then(commit)
            .then(resolve, reject)
            .finally(() => {
                clearMutationTimeout(timeout);
            });
    });
}

function clearMutationTimeout(
    timeout: ReturnType<typeof setTimeout> | undefined
): void {
    if (timeout !== undefined) {
        clearTimeout(timeout);
    }
}
