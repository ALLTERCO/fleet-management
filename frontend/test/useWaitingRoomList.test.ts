import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {type EffectScope, effectScope, nextTick, ref} from 'vue';
import {
    useWaitingRoomList,
    type WaitingRoomMode
} from '@/composables/useWaitingRoomList';
import {
    WAITING_ROOM_BULK_POLL_MAX_FAILURES,
    WAITING_ROOM_BULK_POLL_MS
} from '@/constants';
import {toastRpcError} from '@/helpers/domainErrors';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const waitingRoomData = ref<Record<string, any>>({});
const waitingRoomRefresh = vi.fn();

vi.mock('@vueuse/core', () => ({
    useDocumentVisibility: () => ref('visible'),
    useIntervalFn: vi.fn()
}));

vi.mock('@/composables/useWsRpc', () => ({
    default: vi.fn(() => ({
        data: waitingRoomData,
        loading: ref(false),
        error: ref(null),
        refresh: waitingRoomRefresh
    }))
}));

vi.mock('@/helpers/domainErrors', () => ({
    toastRpcError: vi.fn()
}));

vi.mock('@/helpers/zitadelAuth', () => ({
    getZitadelAuth: vi.fn().mockReturnValue(undefined),
    setAuthLifecycleHandlers: vi.fn()
}));

vi.mock('@/tools/http', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    sendRPC: vi.fn(),
    onWaitingRoomUpdated: vi.fn(() => vi.fn())
}));

function seedLaunchBootstrap() {
    useAuthStore().launchBootstrap = {
        serverTime: '2026-05-22T00:00:00.000Z',
        devices: {visible: true, items: [], total: 0},
        waitingRoom: {
            visible: true,
            pendingCount: 2,
            pending: waitingRoomData.value
        },
        alerts: {visible: true, openCount: 0, criticalCount: 0}
    };
}

describe('useWaitingRoomList', () => {
    // Effect scope so watchers dispose between tests (else they leak onto the
    // shared ref).
    let scope: EffectScope | null = null;
    function create(mode: WaitingRoomMode) {
        scope?.stop();
        scope = effectScope();
        const result = scope.run(() => useWaitingRoomList(mode));
        if (!result) throw new Error('composable failed to run');
        return result;
    }
    afterEach(() => {
        scope?.stop();
        scope = null;
    });

    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        waitingRoomRefresh.mockReset();
        // Production keys pending entries by shellyID (legacy) or
        // deviceIngress:<id> — never a numeric DB id.
        waitingRoomData.value = {
            'shellyplus1-aabbcc': {shellyID: 'shellyplus1-aabbcc', status: {}},
            'shellyplus1-ddeeff': {shellyID: 'shellyplus1-ddeeff', status: {}}
        };
        vi.mocked(ws.sendRPC).mockResolvedValue({});
        seedLaunchBootstrap();
    });

    it('accepts a pending shellyID via AcceptPendingByExternalId and reconciles in the background', async () => {
        const devicesStore = useDevicesStore();
        const reconcile = vi
            .spyOn(devicesStore, 'reconcileDevicesFromBackend')
            .mockResolvedValue(undefined);
        const waitingRoom = create('pending');

        waitingRoom.acceptDevice('shellyplus1-aabbcc');
        await waitingRoom.flushPendingAccepts();

        expect(ws.sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'WaitingRoom.AcceptPendingByExternalId',
            {externalIds: ['shellyplus1-aabbcc']}
        );
        expect(waitingRoom.devices.value).toEqual({
            'shellyplus1-ddeeff': {shellyID: 'shellyplus1-ddeeff', status: {}}
        });
        expect(useAuthStore().launchBootstrap?.waitingRoom.pendingCount).toBe(
            1
        );
        // Success relies on the WS update / interval to re-sync — no immediate
        // refresh that could resurrect the row mid-admit.
        expect(waitingRoomRefresh).not.toHaveBeenCalled();
        expect(reconcile).toHaveBeenCalledWith('waiting-room');
    });

    it('accepts a deviceIngress entry via its own approve RPC', async () => {
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );
        waitingRoomData.value = {
            'deviceIngress:11111111-2222-3333-4444-555555555555': {
                shellyID: 'shellyplus1-aabbcc',
                status: {},
                profileId: 'prof-1'
            }
        };
        const waitingRoom = create('pending');

        waitingRoom.acceptDevice(
            'deviceIngress:11111111-2222-3333-4444-555555555555'
        );
        await waitingRoom.flushPendingAccepts();

        expect(ws.sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'deviceIngress.WaitingRoom.Approve',
            {
                waitingRoomId: '11111111-2222-3333-4444-555555555555',
                action: 'create_new_device',
                profileId: 'prof-1'
            }
        );
        expect(waitingRoom.devices.value).toEqual({});
    });

    it('keeps rows the backend could not accept and toasts the failure', async () => {
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );
        const toastError = vi.spyOn(useToastStore(), 'error');

        vi.mocked(ws.sendRPC).mockResolvedValue({
            success: ['shellyplus1-aabbcc'],
            error: ['shellyplus1-ddeeff']
        });

        const waitingRoom = create('pending');
        await waitingRoom.handleAccept();

        expect(waitingRoom.devices.value).toEqual({
            'shellyplus1-ddeeff': {shellyID: 'shellyplus1-ddeeff', status: {}}
        });
        expect(toastError).toHaveBeenCalledTimes(1);
    });

    it('disables accept while a coalesced accept is in flight', async () => {
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );
        let resolveRpc!: (value: unknown) => void;
        vi.mocked(ws.sendRPC).mockReturnValue(
            new Promise((resolve) => {
                resolveRpc = resolve;
            })
        );
        const waitingRoom = create('pending');

        waitingRoom.acceptDevice('shellyplus1-aabbcc');
        expect(waitingRoom.accepting.value).toBe(true);
        expect(waitingRoom.isAccepting('shellyplus1-aabbcc')).toBe(true);

        const flushed = waitingRoom.flushPendingAccepts();
        await nextTick();
        expect(waitingRoom.accepting.value).toBe(true);

        resolveRpc({success: ['shellyplus1-aabbcc'], error: []});
        await flushed;

        expect(waitingRoom.accepting.value).toBe(false);
        expect(waitingRoom.isAccepting('shellyplus1-aabbcc')).toBe(false);
    });

    it('coalesces rapid per-row accepts into one bulk RPC', async () => {
        vi.useFakeTimers();
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );
        waitingRoomData.value = {
            'shellyplus1-aabbcc': {shellyID: 'shellyplus1-aabbcc', status: {}},
            'shellyplus1-ddeeff': {shellyID: 'shellyplus1-ddeeff', status: {}},
            'shellyplus1-001122': {shellyID: 'shellyplus1-001122', status: {}}
        };
        const waitingRoom = create('pending');

        waitingRoom.acceptDevice('shellyplus1-aabbcc');
        waitingRoom.acceptDevice('shellyplus1-ddeeff');
        waitingRoom.acceptDevice('shellyplus1-001122');

        await vi.runAllTimersAsync();
        vi.useRealTimers();

        const acceptCalls = vi
            .mocked(ws.sendRPC)
            .mock.calls.filter(
                (c) => c[1] === 'WaitingRoom.AcceptPendingByExternalId'
            );
        expect(acceptCalls).toHaveLength(1);
        expect((acceptCalls[0][2] as any).externalIds).toEqual([
            'shellyplus1-aabbcc',
            'shellyplus1-ddeeff',
            'shellyplus1-001122'
        ]);
        expect(waitingRoom.devices.value).toEqual({});
    });

    it('sends an accept-all larger than the chunk size in chunks', async () => {
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );

        const data: Record<string, any> = {};
        for (let i = 1; i <= 250; i++) {
            data[`shelly-${i}`] = {shellyID: `shelly-${i}`, status: {}};
        }
        waitingRoomData.value = data;

        vi.mocked(ws.sendRPC).mockImplementation(
            async (_t: any, method: string, params: any) => {
                if (method === 'WaitingRoom.AcceptPendingByExternalId') {
                    const externalIds = params.externalIds as string[];
                    if (externalIds.includes('shelly-1')) {
                        return {success: [], error: ['shelly-1']};
                    }
                    return {success: externalIds, error: []};
                }
                return {};
            }
        );

        const waitingRoom = create('pending');
        await waitingRoom.handleAccept();

        const acceptCalls = vi
            .mocked(ws.sendRPC)
            .mock.calls.filter(
                (c) => c[1] === 'WaitingRoom.AcceptPendingByExternalId'
            );
        expect(acceptCalls).toHaveLength(2);
        expect((acceptCalls[0][2] as any).externalIds).toHaveLength(200);
        expect((acceptCalls[1][2] as any).externalIds).toHaveLength(50);

        expect(Object.keys(waitingRoom.devices.value)).toEqual(['shelly-1']);
    });

    it('keeps committed chunks and surfaces failure when a later chunk rejects', async () => {
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );

        const data: Record<string, any> = {};
        for (let i = 1; i <= 250; i++) {
            data[`shelly-${i}`] = {shellyID: `shelly-${i}`, status: {}};
        }
        waitingRoomData.value = data;

        vi.mocked(ws.sendRPC).mockImplementation(
            async (_t: any, method: string, params: any) => {
                if (method === 'WaitingRoom.AcceptPendingByExternalId') {
                    const externalIds = params.externalIds as string[];
                    if (externalIds.includes('shelly-201')) {
                        throw new Error('backend rejected chunk');
                    }
                    return {success: externalIds, error: []};
                }
                return {};
            }
        );

        const waitingRoom = create('pending');
        await waitingRoom.handleAccept();

        // First chunk (shelly-1..200) committed and was removed; the failed
        // second chunk's rows remain.
        const remaining = Object.keys(waitingRoom.devices.value);
        expect(remaining).not.toContain('shelly-1');
        expect(remaining).not.toContain('shelly-200');
        expect(remaining).toContain('shelly-201');
        expect(remaining).toHaveLength(50);
        expect(waitingRoom.accepting.value).toBe(false);
        expect(waitingRoomRefresh).toHaveBeenCalled();
    });

    it('restores un-run chunks when an earlier chunk throws (no silent drop)', async () => {
        const devicesStore = useDevicesStore();
        vi.spyOn(devicesStore, 'reconcileDevicesFromBackend').mockResolvedValue(
            undefined
        );
        // 500 → chunks [1-200] ok, [201-400] throws, [401-500] never runs.
        const data: Record<string, any> = {};
        for (let i = 1; i <= 500; i++) {
            data[`shelly-${i}`] = {shellyID: `shelly-${i}`, status: {}};
        }
        waitingRoomData.value = data;

        vi.mocked(ws.sendRPC).mockImplementation(
            async (_t: any, method: string, params: any) => {
                if (method === 'WaitingRoom.AcceptPendingByExternalId') {
                    if (
                        (params.externalIds as string[]).includes('shelly-201')
                    ) {
                        throw new Error('backend rejected chunk');
                    }
                    return {success: params.externalIds, error: []};
                }
                return {};
            }
        );

        const waitingRoom = create('pending');
        await waitingRoom.handleAccept();

        const remaining = Object.keys(waitingRoom.devices.value);
        // Committed chunk gone; failed + un-run chunks restored — none lost.
        expect(remaining).not.toContain('shelly-1');
        expect(remaining).toContain('shelly-201');
        expect(remaining).toContain('shelly-500');
        expect(remaining).toHaveLength(300);
    });

    it('rejects denied-view rows without changing the pending badge count', async () => {
        const waitingRoom = create('denied');

        await waitingRoom.rejectDevice('shellyplus1-aabbcc');

        expect(ws.sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'WaitingRoom.RejectPending',
            {shellyIDs: ['shellyplus1-aabbcc']}
        );
        expect(waitingRoom.devices.value).toEqual({
            'shellyplus1-ddeeff': {shellyID: 'shellyplus1-ddeeff', status: {}}
        });
        expect(useAuthStore().launchBootstrap?.waitingRoom.pendingCount).toBe(
            2
        );
        expect(waitingRoomRefresh).toHaveBeenCalledTimes(1);
    });

    describe('bulk accept (background job)', () => {
        const advancePoll = () =>
            vi.advanceTimersByTimeAsync(WAITING_ROOM_BULK_POLL_MS);

        function seedN(n: number) {
            const data: Record<string, any> = {};
            for (let i = 1; i <= n; i++) {
                data[`shelly-${i}`] = {shellyID: `shelly-${i}`, status: {}};
            }
            waitingRoomData.value = data;
        }
        function spyReconcile() {
            vi.spyOn(
                useDevicesStore(),
                'reconcileDevicesFromBackend'
            ).mockResolvedValue(undefined);
        }
        function statusOf(
            state: string,
            processed: number,
            accepted: number,
            failed: string[] = []
        ) {
            return {
                jobId: 'job-1',
                total: 600,
                processed,
                accepted,
                failed,
                state,
                startedAt: 0,
                updatedAt: 0
            };
        }

        it('routes accept-all above the threshold through the job, not the inline RPC', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const methods: string[] = [];
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                methods.push(method);
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statusOf('running', 0, 0);
                }
                return {};
            });
            const wr = create('pending');

            await wr.handleAccept();

            expect(methods).toContain('WaitingRoom.AcceptBulkStart');
            expect(methods).not.toContain(
                'WaitingRoom.AcceptPendingByExternalId'
            );
            expect(wr.bulkJob.value).toMatchObject({
                jobId: 'job-1',
                total: 600,
                state: 'running'
            });
            vi.useRealTimers();
        });

        it('keeps a small accept-all on the inline path (no job)', async () => {
            spyReconcile();
            // default seed is 2 devices — below the threshold
            const wr = create('pending');
            await wr.handleAccept();

            expect(ws.sendRPC).toHaveBeenCalledWith(
                'FLEET_MANAGER',
                'WaitingRoom.AcceptPendingByExternalId',
                expect.anything()
            );
            const startCalls = vi
                .mocked(ws.sendRPC)
                .mock.calls.filter(
                    (c) => c[1] === 'WaitingRoom.AcceptBulkStart'
                );
            expect(startCalls).toHaveLength(0);
            expect(wr.bulkJob.value).toBeNull();
        });

        it('select-all routes to server-side AcceptAllStart and optimistically onboards the fleet', async () => {
            vi.useFakeTimers();
            spyReconcile();
            const addOptimistic = vi.spyOn(
                useDevicesStore(),
                'addOptimisticDevice'
            );
            waitingRoomData.value = {
                'shelly-a': {
                    shellyID: 'shelly-a',
                    status: {sys: {gen: 2, device: {model: 'X'}}}
                },
                'shelly-b': {shellyID: 'shelly-b', status: {}}
            };
            const methods: string[] = [];
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                methods.push(method);
                if (method === 'WaitingRoom.AcceptAllStart') {
                    return {jobId: 'job-all', total: 2};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statusOf('done', 2, 2);
                }
                return {};
            });
            const wr = create('pending');
            wr.toggleSelectAll(); // select all → server-side accept-all path
            await wr.handleAccept();
            await vi.runAllTimersAsync();

            // Server resolves all; the browser never sends an id list or the
            // inline per-id RPC.
            expect(methods).toContain('WaitingRoom.AcceptAllStart');
            expect(methods).not.toContain(
                'WaitingRoom.AcceptPendingByExternalId'
            );
            // Both devices show in the fleet instantly via optimistic onboard.
            expect(addOptimistic).toHaveBeenCalledTimes(2);
            expect(addOptimistic).toHaveBeenCalledWith(
                'shelly-a',
                expect.anything()
            );
            vi.useRealTimers();
        });

        it('tracks progress across status polls', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const statuses = [
                statusOf('running', 200, 200),
                statusOf('running', 450, 450),
                statusOf('done', 600, 600)
            ];
            let i = 0;
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statuses[Math.min(i++, statuses.length - 1)];
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();
            expect(wr.accepting.value).toBe(true);

            await advancePoll();
            expect(wr.bulkJob.value).toMatchObject({
                processed: 200,
                accepted: 200
            });
            await advancePoll();
            expect(wr.bulkJob.value).toMatchObject({
                processed: 450,
                accepted: 450
            });
            await advancePoll();

            expect(wr.bulkJob.value).toBeNull(); // cleared on finalize
            expect(wr.accepting.value).toBe(false);
            vi.useRealTimers();
        });

        it('on done restores only the failed rows and refreshes', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const statuses = [
                statusOf('running', 300, 300),
                statusOf('done', 600, 598, ['shelly-1', 'shelly-2'])
            ];
            let i = 0;
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statuses[Math.min(i++, statuses.length - 1)];
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();
            await advancePoll();
            await advancePoll();

            expect(Object.keys(wr.devices.value).sort()).toEqual([
                'shelly-1',
                'shelly-2'
            ]);
            expect(waitingRoomRefresh).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('on cancel restores the whole remainder, not just failures', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const info = vi.spyOn(useToastStore(), 'info');
            const statuses = [
                statusOf('running', 200, 200),
                statusOf('canceled', 250, 249, ['shelly-10'])
            ];
            let i = 0;
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statuses[Math.min(i++, statuses.length - 1)];
                }
                if (method === 'WaitingRoom.AcceptBulkCancel') {
                    return {canceled: true};
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();
            await advancePoll();

            await wr.cancelBulkJob();
            expect(info).toHaveBeenCalledTimes(1); // {canceled:true} → info

            await advancePoll(); // poll sees 'canceled' → finalize

            const keys = Object.keys(wr.devices.value);
            expect(keys).toContain('shelly-10'); // failed restored
            expect(keys).toContain('shelly-600'); // un-run remainder restored
            expect(waitingRoomRefresh).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('refuses a second accept while a job is running', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const warn = vi.spyOn(useToastStore(), 'warning');
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statusOf('running', 0, 0);
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept(); // job running; rows removed

            // A new pending row arrives; accepting it must be refused.
            wr.devices.value = {
                'shelly-new': {shellyID: 'shelly-new', status: {}}
            };
            await wr.handleAccept();

            const startCalls = vi
                .mocked(ws.sendRPC)
                .mock.calls.filter(
                    (c) => c[1] === 'WaitingRoom.AcceptBulkStart'
                );
            expect(startCalls).toHaveLength(1); // no second start
            expect(warn).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('retries transient poll failures, then gives up and restores', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    throw new Error('poll dropped');
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();

            for (let n = 0; n < WAITING_ROOM_BULK_POLL_MAX_FAILURES; n++) {
                await advancePoll();
            }

            const statusCalls = vi
                .mocked(ws.sendRPC)
                .mock.calls.filter(
                    (c) => c[1] === 'WaitingRoom.AcceptBulkStatus'
                );
            expect(statusCalls).toHaveLength(
                WAITING_ROOM_BULK_POLL_MAX_FAILURES
            );
            expect(wr.bulkJob.value).toBeNull(); // gave up
            expect(wr.accepting.value).toBe(false);
            expect(Object.keys(wr.devices.value)).toHaveLength(600); // restored
            expect(waitingRoomRefresh).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('warns when cancel missed the window ({canceled:false})', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const warn = vi.spyOn(useToastStore(), 'warning');
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statusOf('running', 0, 0);
                }
                if (method === 'WaitingRoom.AcceptBulkCancel') {
                    return {canceled: false};
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();

            await wr.cancelBulkJob();
            expect(warn).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('restores every row and errors when the job fails to start', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    throw new Error('start failed');
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();

            expect(Object.keys(wr.devices.value)).toHaveLength(600);
            expect(wr.accepting.value).toBe(false);
            expect(wr.bulkJob.value).toBeNull();
            expect(vi.mocked(toastRpcError)).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('restores the snapshot and toasts on an error end state', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const error = vi.spyOn(useToastStore(), 'error');
            const statuses = [
                statusOf('running', 100, 100),
                statusOf('error', 100, 100)
            ];
            let i = 0;
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statuses[Math.min(i++, statuses.length - 1)];
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();
            await advancePoll();
            await advancePoll();

            expect(Object.keys(wr.devices.value)).toHaveLength(600);
            expect(error).toHaveBeenCalled();
            expect(wr.bulkJob.value).toBeNull();
            vi.useRealTimers();
        });

        it('keeps the pending badge a single source after the job', async () => {
            vi.useFakeTimers();
            spyReconcile();
            seedN(600);
            const statuses = [
                statusOf('done', 600, 597, ['shelly-1', 'shelly-2', 'shelly-3'])
            ];
            let i = 0;
            vi.mocked(ws.sendRPC).mockImplementation(async (_t, method) => {
                if (method === 'WaitingRoom.AcceptBulkStart') {
                    return {jobId: 'job-1', total: 600};
                }
                if (method === 'WaitingRoom.AcceptBulkStatus') {
                    return statuses[Math.min(i++, statuses.length - 1)];
                }
                return {};
            });
            const wr = create('pending');
            await wr.handleAccept();
            await advancePoll();
            await nextTick();

            expect(
                useAuthStore().launchBootstrap?.waitingRoom.pendingCount
            ).toBe(3);
            vi.useRealTimers();
        });
    });
});
