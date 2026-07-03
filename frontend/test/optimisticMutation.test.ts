import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    OptimisticMutationTimeoutError,
    runOptimisticMutation
} from '@/stores/optimisticMutation';

describe('runOptimisticMutation', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('applies optimistic state before commit', async () => {
        const events: string[] = [];

        await runOptimisticMutation({
            apply: () => events.push('apply'),
            commit: async () => {
                events.push('commit');
                return 'ok';
            },
            rollback: () => events.push('rollback')
        });

        expect(events).toEqual(['apply', 'commit']);
    });

    it('rolls back when commit rejects', async () => {
        const events: string[] = [];

        await expect(
            runOptimisticMutation({
                apply: () => events.push('apply'),
                commit: async () => {
                    events.push('commit');
                    throw new Error('denied');
                },
                rollback: () => events.push('rollback'),
                reconcile: () => events.push('reconcile')
            })
        ).rejects.toThrow('denied');

        expect(events).toEqual(['apply', 'commit', 'rollback']);
    });

    it('rolls back and clears pending timeout state on timeout', async () => {
        vi.useFakeTimers();
        const events: string[] = [];

        const mutation = runOptimisticMutation({
            apply: () => events.push('apply'),
            commit: () => new Promise<string>(() => undefined),
            rollback: () => events.push('rollback'),
            timeoutMs: 25
        });
        const expectedTimeout = expect(mutation).rejects.toBeInstanceOf(
            OptimisticMutationTimeoutError
        );

        await vi.advanceTimersByTimeAsync(25);

        await expectedTimeout;
        expect(events).toEqual(['apply', 'rollback']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('passes one snapshot through apply, rollback, and error handling', async () => {
        const events: string[] = [];

        await expect(
            runOptimisticMutation({
                snapshot: () => ({state: 'unread'}),
                apply: (snapshot) => events.push(`apply:${snapshot?.state}`),
                commit: async () => {
                    throw new Error('denied');
                },
                rollback: (snapshot) =>
                    events.push(`rollback:${snapshot?.state}`),
                onError: (error, snapshot) => {
                    events.push(
                        `${(error as Error).message}:${snapshot?.state}`
                    );
                }
            })
        ).rejects.toThrow('denied');

        expect(events).toEqual([
            'apply:unread',
            'rollback:unread',
            'denied:unread'
        ]);
    });

    it('reconciles with the committed result on success', async () => {
        const reconciled: Array<{id: number; state: string}> = [];

        const result = await runOptimisticMutation({
            apply: () => undefined,
            commit: async () => ({id: 7, state: 'read'}),
            rollback: () => undefined,
            reconcile: (item) => reconciled.push(item)
        });

        expect(result).toEqual({id: 7, state: 'read'});
        expect(reconciled).toEqual([{id: 7, state: 'read'}]);
    });
});
