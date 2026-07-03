import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const wsCallbacks = vi.hoisted(() => ({
    job: [] as Array<(event: any) => void>
}));

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    onComponentStatus: vi.fn(),
    onJobEvent: vi.fn((cb: (event: any) => void) => {
        wsCallbacks.job.push(cb);
        return vi.fn();
    }),
    onResyncRequired: vi.fn()
}));

vi.mock('@/tools/observability', () => ({
    trackInteraction: vi.fn()
}));

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canExecuteDevice: () => true
    })
}));

vi.mock('@/stores/groups', () => ({
    useGroupsStore: () => ({
        groups: {}
    })
}));

import type {BackupMetadata} from '@/stores/backups';
import {useBackupsStore} from '@/stores/backups';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

function backup(fields: Partial<BackupMetadata> = {}): BackupMetadata {
    return {
        id: 'backup-1',
        name: 'Backup',
        shellyID: 'dev-1',
        model: 'SNSW-001X16EU',
        app: 'Plus1PM',
        fwVersion: '1.0.0',
        createdAt: Date.now(),
        fileSize: 10,
        contents: {},
        metadata: {},
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

function seedBackupCapableDevice(shellyID: string): void {
    useDevicesStore().devices[shellyID] = {
        shellyID,
        online: true,
        capabilities: {backup: true},
        info: {model: 'SNSW-001X16EU', name: shellyID},
        status: {}
    } as any;
}

function emitJobEvent(event: any): void {
    for (const callback of wsCallbacks.job) callback(event);
}

describe('backupsStore backend jobs', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        wsCallbacks.job = [];
        vi.mocked(sendRPC).mockImplementation(
            async (_service: string, method: string) => {
                if (method === 'Backup.List') return {items: []};
                if (method === 'Backup.StartDownloadJob') {
                    return {jobId: 'backup-job-1'};
                }
                if (method === 'Backup.StartRestoreJob') {
                    return {jobId: 'restore-job-1'};
                }
                return {};
            }
        );
    });

    it('applies backup unit events only from the active backend job', async () => {
        seedBackupCapableDevice('dev-1');
        const store = useBackupsStore();
        store.toggleDevice('dev-1');

        await store.createBackups();

        emitJobEvent({
            method: 'Job.UnitUpdated',
            params: {
                jobId: 'other-backup-job',
                kind: 'backup',
                unitId: '1',
                status: 'done',
                deviceId: 'dev-1',
                result: {id: 'wrong-backup', shellyID: 'dev-1'}
            }
        });

        expect(store.backupProgress['dev-1']?.status).toBe('creating');
        expect(store.backups['wrong-backup']).toBeUndefined();

        emitJobEvent({
            method: 'Job.UnitUpdated',
            params: {
                jobId: 'backup-job-1',
                kind: 'backup',
                unitId: '2',
                status: 'done',
                deviceId: 'dev-1',
                result: {
                    id: 'backup-1',
                    shellyID: 'dev-1',
                    name: 'Backup',
                    model: 'SNSW-001X16EU',
                    app: 'Plus1PM',
                    fwVersion: '1.0.0',
                    createdAt: Date.now(),
                    fileSize: 10,
                    contents: {},
                    metadata: {}
                }
            }
        });

        expect(store.backupProgress['dev-1']?.status).toBe('success');
        expect(store.backups['backup-1']).toBeDefined();
    });

    it('queues restore through the backend job API', async () => {
        const store = useBackupsStore();

        const result = await store.restoreBackup('42', 'dev-1', {
            scripts: true,
            schedules: false
        });

        expect(result).toEqual({jobId: 'restore-job-1'});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Backup.StartRestoreJob',
            expect.objectContaining({
                id: '42',
                shellyID: 'dev-1',
                restore: {scripts: true},
                idempotencyKey: expect.any(String)
            })
        );
        expect(
            vi
                .mocked(sendRPC)
                .mock.calls.some(
                    ([, method]) => method === 'Backup.RestoreToDevice'
                )
        ).toBe(false);
    });

    it('coalesces overlapping backup list refreshes into one follow-up refresh', async () => {
        const first = deferred<{items: BackupMetadata[]}>();
        const second = deferred<{items: BackupMetadata[]}>();
        vi.mocked(sendRPC)
            .mockReset()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useBackupsStore();

        const firstFetch = store.fetchBackups();
        const secondFetch = store.fetchBackups();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        first.resolve({items: [backup({id: 'old', name: 'Old'})]});
        await waitForRpcCount(2);
        second.resolve({items: [backup({id: 'fresh', name: 'Fresh'})]});
        await Promise.all([firstFetch, secondFetch]);

        expect(store.backups).toEqual({
            fresh: expect.objectContaining({name: 'Fresh'})
        });
    });
});
