import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    onOtaProgress: vi.fn(() => () => {}),
    onComponentStatus: vi.fn(() => () => {})
}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({info: vi.fn(), success: vi.fn(), error: vi.fn()})
}));

import {useBackgroundOpsStore} from '@/stores/backgroundOps';
import * as ws from '@/tools/websocket';

describe('backgroundOpsStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
    });

    it('registers a job type and subscribes to its WS event', () => {
        const store = useBackgroundOpsStore();
        store.register({
            type: 'firmware',
            policy: 'keep-running',
            wsEvent: 'ota_progress',
            getId: (e: any) => e.shellyID,
            apply: vi.fn()
        });
        expect(ws.onOtaProgress).toHaveBeenCalledOnce();
    });

    it('startJob returns an id and records the job as running', () => {
        const store = useBackgroundOpsStore();
        store.register({
            type: 'firmware',
            policy: 'keep-running',
            wsEvent: 'ota_progress',
            getId: (e: any) => e.shellyID,
            apply: vi.fn()
        });
        const id = store.startJob({
            type: 'firmware',
            deviceIds: ['abc'],
            label: 'Test'
        });
        expect(id).toBeTruthy();
        expect(store.activeJobFor('firmware')?.status).toBe('running');
    });

    it('startJob initializes doneCount and failCount to zero', () => {
        const store = useBackgroundOpsStore();
        const id = store.startJob({
            type: 'firmware',
            deviceIds: ['a', 'b'],
            label: 'T'
        });
        const job = store.jobs.get(id)!;
        expect(job.doneCount).toBe(0);
        expect(job.failCount).toBe(0);
    });

    it('actor transitions update doneCount and failCount on JobRecord', () => {
        const store = useBackgroundOpsStore();
        const id = store.startJob({
            type: 'firmware',
            deviceIds: ['a', 'b', 'c'],
            label: 'T'
        });
        const job = store.jobs.get(id)!;
        job._actor.send({type: 'DEVICE_DONE'});
        job._actor.send({type: 'DEVICE_DONE'});
        job._actor.send({type: 'DEVICE_FAILED', error: 'oops'});
        expect(job.doneCount).toBe(2);
        expect(job.failCount).toBe(1);
    });

    it('completeJob transitions status to done', () => {
        const store = useBackgroundOpsStore();
        store.register({
            type: 'firmware',
            policy: 'keep-running',
            wsEvent: 'ota_progress',
            getId: (e: any) => e.shellyID,
            apply: vi.fn()
        });
        const id = store.startJob({
            type: 'firmware',
            deviceIds: ['abc'],
            label: 'Test'
        });
        store.completeJob(id);
        expect(store.activeJobFor('firmware')).toBeUndefined();
        expect(store.historyFor('firmware')[0]?.status).toBe('done');
    });

    it('abortJob transitions status to cancelled', () => {
        const store = useBackgroundOpsStore();
        store.register({
            type: 'firmware',
            policy: 'keep-running',
            wsEvent: 'ota_progress',
            getId: (e: any) => e.shellyID,
            apply: vi.fn()
        });
        const id = store.startJob({
            type: 'firmware',
            deviceIds: ['abc'],
            label: 'Test'
        });
        store.abortJob(id);
        expect(store.activeJobFor('firmware')).toBeUndefined();
        expect(store.historyFor('firmware')[0]?.status).toBe('cancelled');
    });

    it('progressFor returns counts from reactive record fields', () => {
        const store = useBackgroundOpsStore();
        store.register({
            type: 'firmware',
            policy: 'keep-running',
            wsEvent: 'ota_progress',
            getId: (e: any) => e.shellyID,
            apply: vi.fn()
        });
        const id = store.startJob({
            type: 'firmware',
            deviceIds: ['a', 'b', 'c'],
            label: 'T'
        });
        const job = store.jobs.get(id)!;
        job._actor.send({type: 'DEVICE_DONE'});
        job._actor.send({type: 'DEVICE_FAILED', error: 'oops'});
        const p = store.progressFor('firmware');
        expect(p.done).toBe(1);
        expect(p.failed).toBe(1);
        expect(p.total).toBe(3);
    });

    it('activeJobCount equals number of running jobs', () => {
        const store = useBackgroundOpsStore();
        store.register({
            type: 'firmware',
            policy: 'keep-running',
            wsEvent: 'ota_progress',
            getId: (e: any) => e.shellyID,
            apply: vi.fn()
        });
        store.register({
            type: 'backup',
            policy: 'keep-running',
            wsEvent: 'component_status.backup',
            getId: (e: any) => e.backupProgress?.shellyID,
            apply: vi.fn()
        });
        expect(store.activeJobCount).toBe(0);
        store.startJob({type: 'firmware', deviceIds: ['a'], label: 'F'});
        expect(store.activeJobCount).toBe(1);
        store.startJob({type: 'backup', deviceIds: ['b'], label: 'B'});
        expect(store.activeJobCount).toBe(2);
    });

    it('dispatchToJob updates the addressed job, ignoring whatever is currently active', () => {
        const store = useBackgroundOpsStore();
        const firstId = store.startJob({
            type: 'firmware',
            deviceIds: ['a'],
            label: 'F1'
        });
        store.abortJob(firstId);
        const secondId = store.startJob({
            type: 'firmware',
            deviceIds: ['b'],
            label: 'F2'
        });

        // A late event addressed at the cancelled job must be dropped, not
        // routed to the new active job — that's the F1 regression we fixed.
        store.dispatchToJob(firstId, {type: 'DEVICE_FAILED', error: 'late'});
        expect(store.jobs.get(secondId)!.failCount).toBe(0);

        // Same dispatch addressed at the running job lands.
        store.dispatchToJob(secondId, {type: 'DEVICE_DONE'});
        expect(store.jobs.get(secondId)!.doneCount).toBe(1);
    });

    it('dispatchToJob is a no-op for null id', () => {
        const store = useBackgroundOpsStore();
        // Should not throw.
        store.dispatchToJob(null, {type: 'DEVICE_DONE'});
    });

    it('restoreFromSnapshot marks running jobs as cancelled and sends ABORT to actor', async () => {
        // Drive a real job through production code so localStorage gets
        // populated with whatever shape the persistence path actually writes —
        // then simulate a page reload by recreating the pinia store.
        const seed = useBackgroundOpsStore();
        const id = seed.startJob({
            type: 'firmware',
            deviceIds: ['d1'],
            label: 'Firmware — 1 device'
        });
        const seeded = seed.jobs.get(id)!;
        seeded._actor.send({type: 'DEVICE_DONE'});
        seeded._actor.send({type: 'DEVICE_DONE'});
        // The store batches saves on the next tick — flush before "reload".
        await new Promise((r) => setTimeout(r, 0));

        setActivePinia(createPinia());
        const restored = useBackgroundOpsStore();
        const job = restored.jobs.get(id)!;
        expect(job).toBeDefined();
        expect(job.status).toBe('cancelled');
        expect(job._actor.getSnapshot().value).toBe('cancelled');
        expect(job.doneCount).toBe(2);
    });
});
