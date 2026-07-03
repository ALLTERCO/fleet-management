import type {
    CredentialClearParams,
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
import {toastRpcError} from '@/helpers/domainErrors';
import * as ws from '../tools/websocket';
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

interface CredentialWsEvent {
    method?: string;
    params?: {
        jobId?: string;
        status?: CredentialJobResponse['status'];
        row?: CredentialPushRow;
    };
}

export const useCredentialsStore = defineStore('credentials', () => {
    const credentials = ref<Record<string, DeviceCredentialResponse>>({});
    const loading = ref(false);
    const toast = useToastStore();
    const jobsStore = useJobsStore();

    ws.onCredentialEvent(handleCredentialEvent);

    function handleCredentialEvent(event: CredentialWsEvent): void {
        if (event.method === 'Credential.PushRow' && event.params?.row) {
            applyPushRow(event.params.row);
            return;
        }
        if (
            event.method === 'Credential.JobUpdated' &&
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

    let latestFetchAllResult: DeviceCredentialResponse[] = [];
    const credentialsRefresh =
        createLatestRefreshCoordinator(refreshCredentials);

    async function fetchAll(
        params: CredentialListParams = {}
    ): Promise<DeviceCredentialResponse[]> {
        await credentialsRefresh.request(params);
        return latestFetchAllResult;
    }

    async function refreshCredentials(
        params: CredentialListParams
    ): Promise<void> {
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: DeviceCredentialResponse[]}>(
                'FLEET_MANAGER',
                'credential.list',
                params
            );
            const next: Record<string, DeviceCredentialResponse> = {};
            for (const c of res.items) next[c.device_id] = c;
            credentials.value = next;
            latestFetchAllResult = res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load credentials');
            latestFetchAllResult = [];
        } finally {
            loading.value = false;
        }
    }

    async function setOne(params: CredentialSetParams): Promise<{
        jobId: string;
        pushId: number;
        deviceId: string;
        username: string;
        realm: string;
        password: string;
    } | null> {
        try {
            const r = await ws.sendRPC<{
                jobId: string;
                pushId: number;
                deviceId: string;
                username: string;
                realm: string;
                password: string;
            }>('FLEET_MANAGER', 'credential.set', params);
            trackCredentialJob({
                jobId: r.jobId,
                label: `Set credential (${r.deviceId})`,
                total: 1,
                mode: 'set'
            });
            await fetchAll();
            return r;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to set device credential');
            return null;
        }
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

    async function clearAuth(params: CredentialClearParams): Promise<{
        results: Array<{deviceId: string; ok: boolean; error?: string}>;
    } | null> {
        try {
            const r = await ws.sendRPC<{
                results: Array<{deviceId: string; ok: boolean; error?: string}>;
            }>('FLEET_MANAGER', 'credential.clear', params);
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
            const r = await ws.sendRPC<{items: CredentialPushRow[]}>(
                'FLEET_MANAGER',
                'credential.listpushes',
                params
            );
            return r.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to list credential pushes');
            return [];
        }
    }

    return {
        credentials,
        loading,
        fetchAll,
        setOne,
        rotate,
        clearAuth,
        reveal,
        pushStatus,
        listPushes
    };
});
