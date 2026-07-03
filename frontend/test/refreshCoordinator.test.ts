import {describe, expect, it} from 'vitest';
import {
    createLatestRefreshCoordinator,
    createRefreshCoordinator
} from '@/stores/refreshCoordinator';

interface Deferred {
    promise: Promise<void>;
    resolve(): void;
    reject(error: Error): void;
}

function deferred(): Deferred {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function flushMicrotasks(): Promise<void> {
    return Promise.resolve();
}

function createTrackedRefreshCoordinator(calls: Deferred[]) {
    const first = deferred();
    const second = deferred();
    const coordinator = createRefreshCoordinator(() => {
        const next = calls.length === 0 ? first : second;
        calls.push(next);
        return next.promise;
    });

    return {coordinator, first, second};
}

describe('refreshCoordinator', () => {
    it('runs only one active refresh at a time', async () => {
        const calls: Deferred[] = [];
        const {coordinator, first, second} =
            createTrackedRefreshCoordinator(calls);

        const firstRequest = coordinator.request();
        const secondRequest = coordinator.request();

        expect(calls).toHaveLength(1);
        first.resolve();
        await flushMicrotasks();

        expect(calls).toHaveLength(2);
        second.resolve();
        await Promise.all([firstRequest, secondRequest]);
    });

    it('coalesces many in-flight requests into one follow-up refresh', async () => {
        const calls: Deferred[] = [];
        const {coordinator, first, second} =
            createTrackedRefreshCoordinator(calls);

        const requests = [
            coordinator.request(),
            coordinator.request(),
            coordinator.request()
        ];

        expect(calls).toHaveLength(1);
        first.resolve();
        await flushMicrotasks();

        expect(calls).toHaveLength(2);
        second.resolve();
        await Promise.all(requests);
    });

    it('allows a later refresh after a failed request', async () => {
        const calls: Deferred[] = [];
        const {coordinator, first, second} =
            createTrackedRefreshCoordinator(calls);

        const failedRequest = coordinator.request();
        first.reject(new Error('timeout'));
        await expect(failedRequest).rejects.toThrow('timeout');

        const nextRequest = coordinator.request();
        expect(calls).toHaveLength(2);
        second.resolve();
        await nextRequest;
    });

    it('runs the latest parameterized request after the active one', async () => {
        const first = deferred();
        const second = deferred();
        const inputs: string[] = [];
        const coordinator = createLatestRefreshCoordinator<string>((input) => {
            inputs.push(input);
            return inputs.length === 1 ? first.promise : second.promise;
        });

        const firstRequest = coordinator.request('old-filter');
        const secondRequest = coordinator.request('fresh-filter');

        expect(inputs).toEqual(['old-filter']);
        first.resolve();
        await flushMicrotasks();

        expect(inputs).toEqual(['old-filter', 'fresh-filter']);
        second.resolve();
        await Promise.all([firstRequest, secondRequest]);
    });
});
