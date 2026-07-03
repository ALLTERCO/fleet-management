import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const wsCallbacks = vi.hoisted(() => ({
    certificate: undefined as undefined | ((event: any) => void),
    credential: undefined as undefined | ((event: any) => void)
}));

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    onCertificateEvent: vi.fn((cb: (event: any) => void) => {
        wsCallbacks.certificate = cb;
        return vi.fn();
    }),
    onCredentialEvent: vi.fn((cb: (event: any) => void) => {
        wsCallbacks.credential = cb;
        return vi.fn();
    }),
    onJobEvent: vi.fn(),
    onResyncRequired: vi.fn()
}));

vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({info: vi.fn(), success: vi.fn(), error: vi.fn()})
}));

import {useCertificatesStore} from '@/stores/certificates';
import {
    type DeviceCredentialResponse,
    useCredentialsStore
} from '@/stores/credentials';
import {useJobsStore} from '@/stores/jobs';
import {sendRPC} from '@/tools/websocket';

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

function credential(
    fields: Partial<DeviceCredentialResponse> = {}
): DeviceCredentialResponse {
    return {
        id: 'credential-1',
        tenant_id: 'org',
        device_id: 'dev-1',
        username: 'admin',
        realm: 'shelly',
        rotated_at: '2026-05-22T00:00:00.000Z',
        rotated_by: null,
        last_rotation_status: 'ok',
        last_rotation_error: null,
        ...fields
    };
}

async function waitForRpcCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (vi.mocked(sendRPC).mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(sendRPC).toHaveBeenCalledTimes(count);
}

describe('backend-owned operation jobs', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        wsCallbacks.certificate = undefined;
        wsCallbacks.credential = undefined;
    });

    it('tracks certificate pushes by backend jobId', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            jobId: 'cert-job-1',
            deviceCount: 2
        });

        const store = useCertificatesStore();
        const result = await store.pushToDevices(
            {
                certificateId: '00000000-0000-4000-8000-000000000001',
                slot: 'client_cert',
                target: {deviceIds: ['d1', 'd2']}
            },
            {label: 'Push cert', deviceIds: ['d1', 'd2']}
        );

        const job = useJobsStore().get('cert-job-1');
        expect(result?.jobId).toBe('cert-job-1');
        expect(job?.kind).toBe('certificate');
        expect(job?.total).toBe(2);
        expect(useJobsStore().activeJobCount).toBe(1);
    });

    it('ignores certificate progress for unknown backend jobs', () => {
        useCertificatesStore();

        wsCallbacks.certificate?.({
            method: 'Certificate.PushRow',
            params: {
                jobId: 'missing',
                row: {id: 1, job_id: 'missing', status: 'applied'}
            }
        });

        expect(useJobsStore().jobs.size).toBe(0);
    });

    it('applies certificate row and terminal events to the matching job', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            jobId: 'cert-job-1',
            deviceCount: 2
        });
        const store = useCertificatesStore();
        await store.pushToDevices(
            {
                certificateId: '00000000-0000-4000-8000-000000000001',
                slot: 'client_cert',
                target: {deviceIds: ['d1', 'd2']}
            },
            {label: 'Push cert', deviceIds: ['d1', 'd2']}
        );

        wsCallbacks.certificate?.({
            method: 'Certificate.PushRow',
            params: {
                jobId: 'cert-job-1',
                row: {id: 1, job_id: 'cert-job-1', status: 'applied'}
            }
        });
        wsCallbacks.certificate?.({
            method: 'Certificate.JobUpdated',
            params: {
                job: {
                    id: 'cert-job-1',
                    status: 'done',
                    finished_at: '2026-05-22T00:00:00.000Z'
                }
            }
        });

        const job = useJobsStore().get('cert-job-1');
        expect(job?.doneCount).toBe(1);
        expect(job?.status).toBe('done');
        expect(useJobsStore().activeJobCount).toBe(0);
    });

    it('tracks credential rotation by backend jobId', async () => {
        vi.mocked(sendRPC)
            .mockResolvedValueOnce({
                jobId: 'cred-job-1',
                results: [
                    {deviceId: 'd1', pushId: 1, password: 'p1'},
                    {deviceId: 'd2', pushId: 2, password: 'p2'}
                ]
            })
            .mockResolvedValueOnce({items: []});

        const store = useCredentialsStore();
        const result = await store.rotate({
            target: {deviceIds: ['d1', 'd2']}
        });

        const job = useJobsStore().get('cred-job-1');
        expect(result?.jobId).toBe('cred-job-1');
        expect(job?.kind).toBe('credential');
        expect(job?.total).toBe(2);
    });

    it('applies credential events only to tracked jobs', () => {
        useCredentialsStore();
        const jobs = useJobsStore();
        jobs.track({
            jobId: 'cred-job-1',
            kind: 'credential',
            label: 'Rotate credentials',
            total: 1
        });

        wsCallbacks.credential?.({
            method: 'Credential.PushRow',
            params: {
                jobId: 'other-job',
                row: {id: 1, job_id: 'other-job', status: 'ok'}
            }
        });
        wsCallbacks.credential?.({
            method: 'Credential.PushRow',
            params: {
                jobId: 'cred-job-1',
                row: {id: 2, job_id: 'cred-job-1', status: 'failed'}
            }
        });

        expect(jobs.jobs.size).toBe(1);
        expect(jobs.get('cred-job-1')?.failCount).toBe(1);
    });

    it('runs the latest credential list filter after an active refresh', async () => {
        const first = deferred<{items: DeviceCredentialResponse[]}>();
        const second = deferred<{items: DeviceCredentialResponse[]}>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useCredentialsStore();

        const firstFetch = store.fetchAll({status: 'failed'});
        const secondFetch = store.fetchAll({status: 'ok'});

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'credential.list',
            {status: 'failed'}
        );
        first.resolve({items: [credential({device_id: 'old'})]});
        await waitForRpcCount(2);
        expect(sendRPC).toHaveBeenLastCalledWith(
            'FLEET_MANAGER',
            'credential.list',
            {status: 'ok'}
        );
        second.resolve({items: [credential({device_id: 'fresh'})]});

        await expect(Promise.all([firstFetch, secondFetch])).resolves.toEqual([
            [expect.objectContaining({device_id: 'fresh'})],
            [expect.objectContaining({device_id: 'fresh'})]
        ]);
        expect(store.credentials).toEqual({
            fresh: expect.objectContaining({device_id: 'fresh'})
        });
    });
});
