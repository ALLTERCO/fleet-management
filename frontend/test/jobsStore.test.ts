import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useJobsStore} from '@/stores/jobs';
import {onJobEvent, onResyncRequired, sendRPC} from '@/tools/websocket';

vi.mock('@/tools/websocket', () => ({
    onJobEvent: vi.fn(),
    onResyncRequired: vi.fn(),
    sendRPC: vi.fn()
}));

describe('jobsStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-22T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('tracks jobs by backend jobId', () => {
        const store = useJobsStore();

        const job = store.track({
            jobId: 'job-1',
            kind: 'certificate',
            label: 'Push certificate',
            total: 3
        });

        expect(job.id).toBe('job-1');
        expect(store.get('job-1')?.label).toBe('Push certificate');
        expect(store.activeJobCount).toBe(1);
    });

    it('merges repeated tracking without replacing progress', () => {
        const store = useJobsStore();
        store.track({
            jobId: 'job-1',
            kind: 'certificate',
            label: 'Push certificate',
            total: 3
        });
        store.applyUnit({jobId: 'job-1', unitId: 'row-1', status: 'done'});

        store.track({
            jobId: 'job-1',
            kind: 'certificate',
            label: 'Push certificate again',
            total: 4
        });

        expect(store.get('job-1')?.label).toBe('Push certificate again');
        expect(store.get('job-1')?.total).toBe(4);
        expect(store.get('job-1')?.doneCount).toBe(1);
    });

    it('counts unit transitions exactly once per unit', () => {
        const store = useJobsStore();
        store.track({
            jobId: 'job-1',
            kind: 'certificate',
            label: 'Push certificate',
            total: 2
        });

        store.applyUnit({jobId: 'job-1', unitId: 'row-1', status: 'done'});
        store.applyUnit({jobId: 'job-1', unitId: 'row-1', status: 'done'});
        store.applyUnit({jobId: 'job-1', unitId: 'row-2', status: 'failed'});

        expect(store.get('job-1')?.doneCount).toBe(1);
        expect(store.get('job-1')?.failCount).toBe(1);
    });

    it('ignores progress events for unknown jobs', () => {
        const store = useJobsStore();

        store.applyUnit({
            jobId: 'missing',
            unitId: 'row-1',
            status: 'done'
        });
        store.applyStatus({jobId: 'missing', status: 'done'});

        expect(store.jobs.size).toBe(0);
    });

    it('marks terminal jobs inactive', () => {
        const store = useJobsStore();
        store.track({
            jobId: 'job-1',
            kind: 'certificate',
            label: 'Push certificate',
            total: 1
        });

        store.applyStatus({jobId: 'job-1', status: 'done'});

        expect(store.activeJobCount).toBe(0);
        expect(store.get('job-1')?.endedAt).toBe(Date.now());
    });

    it('applies generic backend job events', () => {
        const store = useJobsStore();
        store.track({
            jobId: 'backup-job-1',
            kind: 'backup',
            label: 'Create backup',
            total: 1
        });
        const handler = vi.mocked(onJobEvent).mock.calls[0]?.[0];

        handler?.({
            method: 'Job.UnitUpdated',
            params: {
                jobId: 'backup-job-1',
                unitId: '1',
                status: 'done'
            }
        });
        handler?.({
            method: 'Job.Updated',
            params: {
                job: {
                    id: 'backup-job-1',
                    kind: 'backup',
                    status: 'done',
                    total: 1,
                    doneCount: 1,
                    failCount: 0,
                    createdAt: '2026-05-22T00:00:00.000Z',
                    startedAt: '2026-05-22T00:00:01.000Z',
                    endedAt: '2026-05-22T00:00:02.000Z',
                    createdBy: 'admin',
                    metadata: {mode: 'create'}
                }
            }
        });

        expect(store.get('backup-job-1')?.doneCount).toBe(1);
        expect(store.get('backup-job-1')?.status).toBe('done');
        expect(store.activeJobCount).toBe(0);
    });

    it('restores active jobs from backend snapshots', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            items: [
                {
                    id: 'job-1',
                    kind: 'credential',
                    status: 'running',
                    total: 2,
                    doneCount: 1,
                    failCount: 0,
                    createdAt: '2026-05-22T00:00:00.000Z',
                    startedAt: '2026-05-22T00:00:01.000Z',
                    endedAt: null,
                    createdBy: 'admin',
                    metadata: {mode: 'rotate'}
                }
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false
        });

        const store = useJobsStore();
        await store.restoreActive();

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'job.listactive',
            {}
        );
        expect(store.get('job-1')?.label).toBe('rotate credentials');
        expect(store.get('job-1')?.doneCount).toBe(1);
    });

    it('restores backup jobs from backend snapshots', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            items: [
                {
                    id: 'backup-job-1',
                    kind: 'backup',
                    status: 'queued',
                    total: 3,
                    doneCount: 0,
                    failCount: 0,
                    createdAt: '2026-05-22T00:00:00.000Z',
                    startedAt: null,
                    endedAt: null,
                    createdBy: 'admin',
                    metadata: {mode: 'create'}
                }
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false
        });

        const store = useJobsStore();
        await store.restoreActive();

        expect(store.get('backup-job-1')?.label).toBe('Create backup');
    });

    it('restores firmware jobs from backend snapshots', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            items: [
                {
                    id: 'firmware-job-1',
                    kind: 'firmware',
                    status: 'running',
                    total: 2,
                    doneCount: 1,
                    failCount: 0,
                    createdAt: '2026-05-22T00:00:00.000Z',
                    startedAt: '2026-05-22T00:00:01.000Z',
                    endedAt: null,
                    createdBy: 'admin',
                    metadata: {mode: 'channel'}
                }
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false
        });

        const store = useJobsStore();
        await store.restoreActive();

        expect(store.get('firmware-job-1')?.label).toBe('Firmware update');
        expect(store.get('firmware-job-1')?.doneCount).toBe(1);
    });

    it('reconciles active jobs when websocket stream requires resync', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            items: [
                {
                    id: 'job-1',
                    kind: 'backup',
                    status: 'running',
                    total: 1,
                    doneCount: 0,
                    failCount: 0,
                    createdAt: '2026-05-22T00:00:00.000Z',
                    startedAt: '2026-05-22T00:00:01.000Z',
                    endedAt: null,
                    createdBy: 'admin',
                    metadata: {mode: 'restore'}
                }
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false
        });
        const store = useJobsStore();
        const handler = vi.mocked(onResyncRequired).mock.calls[0]?.[0];

        handler?.('stream_trimmed');
        await vi.waitFor(() => {
            expect(store.get('job-1')?.label).toBe('Restore backup');
        });

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'job.listactive',
            {}
        );
        expect(sendRPC).toHaveBeenCalledTimes(1);
    });

    it('reconciles locally active jobs missing from the active backend list', async () => {
        vi.mocked(sendRPC)
            .mockResolvedValueOnce({
                items: [],
                total: 0,
                limit: 50,
                offset: 0,
                has_more: false
            })
            .mockResolvedValueOnce({
                id: 'job-1',
                kind: 'certificate',
                status: 'done',
                total: 1,
                doneCount: 1,
                failCount: 0,
                createdAt: '2026-05-22T00:00:00.000Z',
                startedAt: '2026-05-22T00:00:01.000Z',
                endedAt: '2026-05-22T00:00:02.000Z',
                createdBy: 'admin',
                metadata: {slot: 'client_cert'}
            });

        const store = useJobsStore();
        store.track({
            jobId: 'job-1',
            kind: 'certificate',
            label: 'Push certificate',
            total: 1
        });

        await store.restoreActive();

        expect(sendRPC).toHaveBeenNthCalledWith(2, 'FLEET_MANAGER', 'job.get', {
            jobId: 'job-1',
            kind: 'certificate'
        });
        expect(store.get('job-1')?.status).toBe('done');
        expect(store.activeJobCount).toBe(0);
    });
});
