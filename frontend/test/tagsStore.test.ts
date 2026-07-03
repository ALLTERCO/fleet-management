import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import type {TagAssignmentRef} from '@api/tag';
import {useTagsStore} from '@/stores/tags';

function pagedEnvelope<T>(items: T[]) {
    return {
        items,
        total: items.length,
        limit: 1000,
        offset: 0,
        has_more: false
    };
}

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function device(subjectId: string): TagAssignmentRef {
    return {subjectType: 'device', subjectId};
}

describe('tags store assignment optimism', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
    });

    it('assignSubjects applies assignments before tag.assign resolves', async () => {
        const rpc = deferred<void>();
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'tag.assign') return rpc.promise;
            if (method === 'tag.listassignments') {
                return pagedEnvelope([device('shelly-a'), device('shelly-b')]);
            }
            throw new Error(`unexpected ${method}`);
        });
        const store = useTagsStore();
        store.assignments = {5: [device('shelly-a')]};

        const command = store.assignSubjects(5, [device('shelly-b')]);

        expect(store.assignments[5]).toEqual([
            device('shelly-a'),
            device('shelly-b')
        ]);
        rpc.resolve();
        await expect(command).resolves.toBe(true);
        expect(sendRPC).toHaveBeenCalledWith('FLEET_MANAGER', 'tag.assign', {
            id: 5,
            subjects: [device('shelly-b')]
        });
    });

    it('unassignSubjects rolls back assignments when tag.unassign fails', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'tag.unassign') throw new Error('denied');
            throw new Error(`unexpected ${method}`);
        });
        const store = useTagsStore();
        store.assignments = {5: [device('shelly-a'), device('shelly-b')]};

        await expect(
            store.unassignSubjects(5, [device('shelly-b')])
        ).resolves.toBe(false);

        expect(store.assignments[5]).toEqual([
            device('shelly-a'),
            device('shelly-b')
        ]);
        expect(toastError).toHaveBeenCalledWith('denied');
    });
});
