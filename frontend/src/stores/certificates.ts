import type {
    CertificateImportParams,
    CertificateIssueDefaults,
    CertificateIssueDeviceParams,
    CertificateJobResponse,
    CertificateListParams,
    CertificatePushRow,
    CertificatePushToDevicesParams,
    CertificateResponse
} from '@api/certificate';
import {defineStore} from 'pinia';
import {reactive, ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import * as ws from '../tools/websocket';
import {useJobsStore} from './jobs';
import {useToastStore} from './toast';

interface CertificateWsEvent {
    method?: string;
    params?: {
        jobId?: string;
        row?: CertificatePushRow;
        job?: CertificateJobResponse;
    };
}

export type {CertificateResponse};

export const useCertificatesStore = defineStore('certificates', () => {
    const certificates = ref<Record<string, CertificateResponse>>({});
    const loading = ref(false);
    const toast = useToastStore();
    const jobsStore = useJobsStore();

    // Per-job push-row cache for the current page; keyed by jobId.
    const pushRows = reactive<Record<string, CertificatePushRow[]>>({});

    ws.onCertificateEvent(handleCertificateEvent);

    function handleCertificateEvent(event: CertificateWsEvent): void {
        if (event.method === 'Certificate.PushRow' && event.params?.row) {
            applyPushRow(event.params.row);
            return;
        }
        if (event.method === 'Certificate.JobUpdated' && event.params?.job) {
            jobsStore.applyStatus({
                jobId: event.params.job.id,
                status: event.params.job.status,
                endedAt: event.params.job.finished_at
                    ? Date.parse(event.params.job.finished_at)
                    : undefined
            });
        }
    }

    function applyPushRow(row: CertificatePushRow): void {
        const list = pushRows[row.job_id] ?? [];
        const idx = list.findIndex((x) => x.id === row.id);
        if (idx >= 0) list[idx] = row;
        else list.push(row);
        pushRows[row.job_id] = list;

        if (row.status === 'applied') {
            jobsStore.applyUnit({
                jobId: row.job_id,
                unitId: String(row.id),
                status: 'done'
            });
        } else if (row.status === 'failed' || row.status === 'rolled_back') {
            jobsStore.applyUnit({
                jobId: row.job_id,
                unitId: String(row.id),
                status: 'failed'
            });
        }
    }

    function trackCertificateJob(input: {
        jobId: string;
        label: string;
        total: number;
        status?: CertificateJobResponse['status'];
        slot?: string;
    }): void {
        jobsStore.track({
            jobId: input.jobId,
            kind: 'certificate',
            label: input.label,
            total: input.total,
            status: input.status,
            metadata: input.slot ? {slot: input.slot} : undefined
        });
    }

    async function fetchAll(
        params: CertificateListParams = {}
    ): Promise<CertificateResponse[]> {
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: CertificateResponse[]}>(
                'FLEET_MANAGER',
                'certificate.list',
                params
            );
            const next: Record<string, CertificateResponse> = {};
            for (const c of res.items) next[c.id] = c;
            certificates.value = next;
            return res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load certificates');
            return [];
        } finally {
            loading.value = false;
        }
    }

    async function importPem(
        params: CertificateImportParams
    ): Promise<CertificateResponse | null> {
        try {
            const c = await ws.sendRPC<CertificateResponse>(
                'FLEET_MANAGER',
                'certificate.import',
                params
            );
            certificates.value = {...certificates.value, [c.id]: c};
            toast.success(`Imported ${c.name}`);
            return c;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to import certificate');
            return null;
        }
    }

    async function remove(id: string): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'certificate.delete', {id});
            const {[id]: _removed, ...rest} = certificates.value;
            certificates.value = rest;
            toast.success('Certificate deleted');
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete certificate');
            return false;
        }
    }

    async function rename(id: string, name: string): Promise<boolean> {
        try {
            const c = await ws.sendRPC<CertificateResponse>(
                'FLEET_MANAGER',
                'certificate.update',
                {id, name}
            );
            certificates.value = {...certificates.value, [c.id]: c};
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update certificate');
            return false;
        }
    }

    async function setTags(id: string, tags: string[]): Promise<boolean> {
        try {
            const r = await ws.sendRPC<{id: string; tags: string[]}>(
                'FLEET_MANAGER',
                'certificate.setTags',
                {id, tags}
            );
            const prev = certificates.value[id];
            if (prev) {
                certificates.value = {
                    ...certificates.value,
                    [id]: {...prev, tags: r.tags}
                };
            }
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update tags');
            return false;
        }
    }

    async function setGroups(id: string, groupIds: number[]): Promise<boolean> {
        try {
            const r = await ws.sendRPC<{
                id: string;
                device_group_ids: number[];
            }>('FLEET_MANAGER', 'certificate.setGroups', {id, groupIds});
            const prev = certificates.value[id];
            if (prev) {
                certificates.value = {
                    ...certificates.value,
                    [id]: {...prev, device_group_ids: r.device_group_ids}
                };
            }
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update device groups');
            return false;
        }
    }

    // Pulls the full row INCLUDING the PEM, triggers a browser download
    // via Blob → object-URL → anchor.click().
    async function downloadPem(id: string, filename: string): Promise<boolean> {
        try {
            const r = await ws.sendRPC<CertificateResponse & {pem?: string}>(
                'FLEET_MANAGER',
                'certificate.get',
                {id, includePem: true}
            );
            const pem = r.pem;
            if (!pem) {
                toast.error('Server returned no PEM for this certificate');
                return false;
            }
            const blob = new Blob([pem], {type: 'application/x-pem-file'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to download PEM');
            return false;
        }
    }

    async function pushToDevices(
        params: CertificatePushToDevicesParams,
        opts: {label?: string; deviceIds?: string[]} = {}
    ): Promise<{jobId: string; deviceCount: number} | null> {
        const label = opts.label ?? `Push cert (${params.slot})`;
        try {
            const r = await ws.sendRPC<{jobId: string; deviceCount: number}>(
                'FLEET_MANAGER',
                'certificate.pushToDevices',
                params
            );
            trackCertificateJob({
                jobId: r.jobId,
                label,
                total: r.deviceCount,
                slot: params.slot
            });
            toast.info(
                `Push job ${r.jobId} queued for ${r.deviceCount} device(s)`
            );
            return r;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to start cert push');
            return null;
        }
    }

    async function pushStatus(jobId: string): Promise<{
        job: CertificateJobResponse;
        rows: CertificatePushRow[];
    } | null> {
        try {
            const result = await ws.sendRPC<{
                job: CertificateJobResponse;
                rows: CertificatePushRow[];
            }>('FLEET_MANAGER', 'certificate.pushStatus', {jobId});
            trackCertificateJob({
                jobId: result.job.id,
                label: `Push cert (${result.job.slot})`,
                total: result.rows.length,
                status: result.job.status,
                slot: result.job.slot
            });
            for (const row of result.rows) applyPushRow(row);
            return result;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load push status');
            return null;
        }
    }

    async function getIssueDefaults(): Promise<CertificateIssueDefaults | null> {
        try {
            return await ws.sendRPC<CertificateIssueDefaults>(
                'FLEET_MANAGER',
                'certificate.getIssueDefaults',
                {}
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load cert issue defaults');
            return null;
        }
    }

    async function issueDeviceCert(
        params: CertificateIssueDeviceParams
    ): Promise<CertificateResponse | null> {
        try {
            const c = await ws.sendRPC<CertificateResponse>(
                'FLEET_MANAGER',
                'certificate.issueDeviceCert',
                params
            );
            certificates.value = {...certificates.value, [c.id]: c};
            toast.success(`Issued device cert for ${params.shellyId}`);
            return c;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to issue device certificate');
            return null;
        }
    }

    return {
        certificates,
        loading,
        pushRows,
        fetchAll,
        getIssueDefaults,
        importPem,
        issueDeviceCert,
        pushToDevices,
        pushStatus,
        remove,
        rename,
        setTags,
        setGroups,
        downloadPem
    };
});
