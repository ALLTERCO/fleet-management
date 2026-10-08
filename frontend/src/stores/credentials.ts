import type {
    CredentialClearParams,
    CredentialGetManyResult,
    CredentialJobResponse,
    CredentialListParams,
    CredentialListPushesParams,
    CredentialPushRow,
    CredentialPushStatusParams,
    CredentialRotateParams,
    CredentialSetParams,
    DeviceCredentialResponse
} from '@api/credential';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {formatRpcError, toastRpcError} from '@/helpers/domainErrors';
import {BACKEND_LIST_MAX_LIMIT, paginateWhileFull} from '@/helpers/pagination';
import {
    type CursorPage,
    paginateByCursor
} from '@/shell/template-host/core/pagination';
import {createBatchCoalescer} from '../tools/coalesce';
import {deferWhileHidden} from '../tools/hiddenTabDeferral';
import * as ws from '../tools/websocket';
import {CREDENTIAL_EVENT} from '../tools/wsEvents';
import {useJobsStore} from './jobs';
import {createLatestRefreshCoordinator} from './refreshCoordinator';
import {useToastStore} from './toast';

export type {
    CredentialJobResponse,
    CredentialPushRow,
    DeviceCredentialResponse
};

interface RotateResultEntry {
    deviceId: string;
    pushId: number;
    password: string;
}

export interface CredentialSetResult {
    jobId: string;
    pushId: number;
    deviceId: string;
    username: string;
    realm: string;
    password: string;
}

export interface CredentialSetFailure {
    deviceId: string;
    error: string;
}

interface CredentialWsEvent {
    method?: string;
    params?: {
        jobId?: string;
        status?: CredentialJobResponse['status'];
        row?: CredentialPushRow;
        deviceId?: string;
    };
}

// Matches CREDENTIAL_GET_MANY_MAX_IDS; a bigger burst rereads the list.
const CHANGED_BATCH_MAX = 500;
const CHANGED_QUIET_MS = 400;
const CHANGED_MAX_WAIT_MS = 2000;

export const useCredentialsStore = defineStore('credentials', () => {
    const credentials = ref<Record<string, DeviceCredentialResponse>>({});
    const loading = ref(false);
    const toast = useToastStore();
    const jobsStore = useJobsStore();

    ws.onCredentialEvent(handleCredentialEvent);

    function handleCredentialEvent(event: CredentialWsEvent): void {
        if (event.method === CREDENTIAL_EVENT.CHANGED) {
            if (loaded && event.params?.deviceId) {
                changedBurst.schedule(event.params.deviceId);
            }
            return;
        }
        if (event.method === CREDENTIAL_EVENT.PUSH_ROW && event.params?.row) {
            applyPushRow(event.params.row);
            return;
        }
        if (
            event.method === CREDENTIAL_EVENT.JOB_UPDATED &&
            event.params?.jobId &&
            event.params?.status
        ) {
            jobsStore.applyStatus({
                jobId: event.params.jobId,
                status: event.params.status
            });
        }
    }

    function applyPushRow(row: CredentialPushRow): void {
        if (row.status === 'ok') {
            jobsStore.applyUnit({
                jobId: row.job_id,
                unitId: String(row.id),
                status: 'done'
            });
        } else if (row.status === 'failed' || row.status === 'unknown') {
            jobsStore.applyUnit({
                jobId: row.job_id,
                unitId: String(row.id),
                status: 'failed'
            });
        }
    }

    function trackCredentialJob(input: {
        jobId: string;
        label: string;
        total: number;
        status?: CredentialJobResponse['status'];
        mode?: CredentialJobResponse['mode'];
    }): void {
        jobsStore.track({
            jobId: input.jobId,
            kind: 'credential',
            label: input.label,
            total: input.total,
            status: input.status,
            metadata: input.mode ? {mode: input.mode} : undefined
        });
    }

    // Changed devices wait here while the tab is hidden.
    const changedDeviceIds = new Set<string>();
    const changedRead = deferWhileHidden(() => {
        const ids = [...changedDeviceIds];
        changedDeviceIds.clear();
        void syncChanged(ids);
    });
    const changedBurst = createBatchCoalescer<string>(
        (ids) => {
            for (const id of ids) changedDeviceIds.add(id);
            changedRead.request();
        },
        CHANGED_QUIET_MS,
        CHANGED_MAX_WAIT_MS
    );

    async function syncChanged(deviceIds: string[]): Promise<void> {
        if (deviceIds.length === 0) return;
        if (deviceIds.length > CHANGED_BATCH_MAX) {
            await fetchAll();
            return;
        }
        try {
            const res = await ws.sendRPC<CredentialGetManyResult>(
                'FLEET_MANAGER',
                'credential.getmany',
                {deviceIds}
            );
            applyChangedCredentials(res);
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load credentials');
        }
    }

    function applyChangedCredentials(res: CredentialGetManyResult): void {
        const next = {...credentials.value};
        for (const c of res.items ?? []) next[c.device_id] = c;
        for (const id of res.missingIds ?? []) delete next[id];
        credentials.value = next;
    }

    // Live events update only a list someone loaded.
    let loaded = false;
    let latestFetchAllResult: DeviceCredentialResponse[] = [];
    const credentialsRefresh =
        createLatestRefreshCoordinator(refreshCredentials);

    async function fetchAll(
        params: CredentialListParams = {}
    ): Promise<DeviceCredentialResponse[]> {
        await credentialsRefresh.request(params);
        return latestFetchAllResult;
    }

    // Cursor pages, one state write after the whole pass.
    async function refreshCredentials(
        params: CredentialListParams
    ): Promise<void> {
        loading.value = true;
        try {
            const {items} = await paginateByCursor((cursor) =>
                ws.sendRPC<CursorPage<DeviceCredentialResponse>>(
                    'FLEET_MANAGER',
                    'credential.list',
                    {
                        ...params,
                        limit: BACKEND_LIST_MAX_LIMIT,
                        ...(cursor ? {cursor} : {})
                    }
                )
            );
            const next: Record<string, DeviceCredentialResponse> = {};
            for (const c of items) next[c.device_id] = c;
            credentials.value = next;
            latestFetchAllResult = items;
            loaded = true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load credentials');
            latestFetchAllResult = [];
        } finally {
            loading.value = false;
        }
    }

    // Per-device outcomes; one list refresh at the end.
    async function setMany(items: CredentialSetParams[]): Promise<{
        succeeded: CredentialSetResult[];
        failed: CredentialSetFailure[];
    }> {
        const succeeded: CredentialSetResult[] = [];
        const failed: CredentialSetFailure[] = [];
        for (const params of items) {
            try {
                const r = await ws.sendRPC<CredentialSetResult>(
                    'FLEET_MANAGER',
                    'credential.set',
                    params
                );
                trackCredentialJob({
                    jobId: r.jobId,
                    label: `Set credential (${r.deviceId})`,
                    total: 1,
                    mode: 'set'
                });
                succeeded.push(r);
            } catch (err) {
                failed.push({
                    deviceId: params.deviceId,
                    error: formatRpcError(
                        err,
                        'Failed to set device credential'
                    )
                });
            }
        }
        if (succeeded.length > 0) await fetchAll();
        return {succeeded, failed};
    }

    async function rotate(
        params: CredentialRotateParams
    ): Promise<{jobId: string; results: RotateResultEntry[]} | null> {
        try {
            const r = await ws.sendRPC<{
                jobId: string;
                results: RotateResultEntry[];
            }>('FLEET_MANAGER', 'credential.rotate', params);
            trackCredentialJob({
                jobId: r.jobId,
                label: `Rotate credentials (${r.results.length})`,
                total: r.results.length,
                mode: 'rotate'
            });
            toast.info(
                `Queued ${r.results.length} rotation(s) — track in the credential push log`
            );
            await fetchAll();
            return r;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to rotate credentials');
            return null;
        }
    }

    // Failures arrive later as Credential.PushRow events, so track the job.
    async function clearAuth(params: CredentialClearParams): Promise<{
        jobId: string;
        results: Array<{deviceId: string; pushId: number}>;
    } | null> {
        try {
            const r = await ws.sendRPC<{
                jobId: string;
                results: Array<{deviceId: string; pushId: number}>;
            }>('FLEET_MANAGER', 'credential.clear', params);
            trackCredentialJob({
                jobId: r.jobId,
                label: `Clear auth (${r.results.length})`,
                total: r.results.length,
                mode: 'clear'
            });
            toast.info(
                `Queued ${r.results.length} auth clear(s) — track in the credential push log`
            );
            await fetchAll();
            return r;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to clear device auth');
            return null;
        }
    }

    async function reveal(
        deviceId: string,
        justification?: string
    ): Promise<{password: string} | null> {
        try {
            return await ws.sendRPC<{password: string}>(
                'FLEET_MANAGER',
                'credential.reveal',
                {deviceId, justification}
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to reveal credential');
            return null;
        }
    }

    async function pushStatus(
        params: CredentialPushStatusParams
    ): Promise<{job: CredentialJobResponse; rows: CredentialPushRow[]} | null> {
        try {
            const result = await ws.sendRPC<{
                job: CredentialJobResponse;
                rows: CredentialPushRow[];
            }>('FLEET_MANAGER', 'credential.pushstatus', params);
            trackCredentialJob({
                jobId: result.job.id,
                label: `${result.job.mode} credentials`,
                total: result.rows.length,
                status: result.job.status,
                mode: result.job.mode
            });
            for (const row of result.rows) applyPushRow(row);
            return result;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to fetch credential push status');
            return null;
        }
    }

    async function listPushes(
        params: CredentialListPushesParams = {}
    ): Promise<CredentialPushRow[]> {
        try {
            return await paginateWhileFull<CredentialPushRow>(
                (offset) =>
                    ws.sendRPC('FLEET_MANAGER', 'credential.listpushes', {
                        ...params,
                        limit: BACKEND_LIST_MAX_LIMIT,
                        offset
                    }),
                BACKEND_LIST_MAX_LIMIT
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to list credential pushes');
            return [];
        }
    }

    return {
        credentials,
        loading,
        fetchAll,
        setMany,
        rotate,
        clearAuth,
        reveal,
        pushStatus,
        listPushes
    };
});
