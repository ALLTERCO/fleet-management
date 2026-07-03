import apiClient from '@/helpers/axios';
import type {RuntimeRecord} from '@/helpers/monitoringRuntime';

export interface RuntimeContractPayloads {
    versionInfo: RuntimeRecord;
    manifestPayload: RuntimeRecord | null;
    manifestError: string | null;
    deviceUsagePayload: RuntimeRecord | null;
    deviceUsageError: string | null;
}

// The control plane is absent outside SaaS (e.g. dev). Once it 404s, stop
// re-requesting it so the poll loop doesn't spam the console every cycle.
let controlPlaneAvailable = true;

export async function loadRuntimeContractPayloads(): Promise<RuntimeContractPayloads> {
    const [version, manifest, usage] = await Promise.all([
        fetchRuntimeJson('/version'),
        fetchControlPlaneJson('/api/control-plane/deploy-manifest'),
        fetchControlPlaneJson('/api/control-plane/device-usage')
    ]);

    return {
        versionInfo: version.data ?? {},
        manifestPayload: manifest.data,
        manifestError: manifest.error,
        deviceUsagePayload: usage.data,
        deviceUsageError: usage.error
    };
}

export async function loadDeployManifestPayload(): Promise<{
    manifestPayload: RuntimeRecord | null;
    manifestError: string | null;
}> {
    const manifest = await fetchControlPlaneJson(
        '/api/control-plane/deploy-manifest'
    );
    return {
        manifestPayload: manifest.data,
        manifestError: manifest.error
    };
}

async function fetchControlPlaneJson(path: string): Promise<{
    data: RuntimeRecord | null;
    error: string | null;
}> {
    if (!controlPlaneAvailable) return {data: null, error: 'not_available'};
    const result = await fetchRuntimeJson(path);
    if (result.error === 'not_available') controlPlaneAvailable = false;
    return result;
}

async function fetchRuntimeJson(path: string): Promise<{
    data: RuntimeRecord | null;
    error: string | null;
}> {
    try {
        const response = await apiClient.get(path);
        return {data: response.data ?? {}, error: null};
    } catch (err: unknown) {
        const status = responseStatus(err);
        if (status === 404) return {data: null, error: 'not_available'};
        if (status === 401 || status === 403) {
            return {data: null, error: 'not_allowed'};
        }
        return {data: null, error: 'error'};
    }
}

function responseStatus(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const response = (err as {response?: {status?: unknown}}).response;
    return typeof response?.status === 'number' ? response.status : null;
}
