export const FLEET_MANAGER_FOLDER_TITLE = 'Fleet Manager';

export interface GrafanaFolder {
    title: string;
    uid?: string;
}

export class GrafanaApiError extends Error {
    constructor(
        readonly status: number,
        statusText: string
    ) {
        super(`Grafana API ${status} ${statusText}`);
    }
}

function isGrafanaFolder(value: unknown): value is GrafanaFolder {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as GrafanaFolder).title === 'string'
    );
}

export function findFleetManagerFolder(
    folders: unknown
): GrafanaFolder | undefined {
    if (!Array.isArray(folders)) {
        return undefined;
    }
    return folders.find(
        (folder): folder is GrafanaFolder =>
            isGrafanaFolder(folder) &&
            folder.title === FLEET_MANAGER_FOLDER_TITLE
    );
}

export function isGrafanaFoldersResponse(
    value: unknown
): value is GrafanaFolder[] {
    return Array.isArray(value) && value.every(isGrafanaFolder);
}

export interface CachedDashboard {
    slug: string;
    uid?: string;
    hash?: string;
}

// Look up a synced dashboard in the boot-provisioning cache by slug.
export function findDashboardBySlug(
    config: unknown,
    slug: string
): CachedDashboard | undefined {
    const dashboards = (config as {dashboards?: CachedDashboard[]} | null)
        ?.dashboards;
    if (!Array.isArray(dashboards)) return undefined;
    return dashboards.find((d) => d?.slug === slug);
}

export interface GrafanaIdentity {
    username: string;
    role: string;
    displayName?: string;
    email?: string;
}

// Grafana runs behind its auth-proxy (GF_AUTH_PROXY) — identity is asserted via
// X-WEBAUTH-* headers. One home for that mapping, shared by the browser proxy
// and boot-time provisioning.
export function grafanaAuthProxyHeaders(
    identity: GrafanaIdentity
): Record<string, string> {
    const headers: Record<string, string> = {
        'X-WEBAUTH-USER': identity.username,
        'X-WEBAUTH-ROLE': identity.role
    };
    if (identity.displayName) headers['X-WEBAUTH-NAME'] = identity.displayName;
    if (identity.email) headers['X-WEBAUTH-EMAIL'] = identity.email;
    return headers;
}

export function isGrafanaUnavailableError(error: unknown): boolean {
    if (error instanceof GrafanaApiError) {
        return error.status === 401 || error.status === 403;
    }
    // fetch throws TypeError only on network failure, never HTTP status —
    // so 'fetch failed' means Grafana isn't reachable.
    if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
        return true;
    }
    const code = (error as {cause?: {code?: string}} | null)?.cause?.code;
    return (
        code === 'EAI_AGAIN' ||
        code === 'ECONNREFUSED' ||
        code === 'ENOTFOUND' ||
        code === 'ECONNRESET'
    );
}

interface WaitForReadyOptions {
    timeoutMs: number;
    pollIntervalMs: number;
    /** Resolves true once Grafana answers its health probe. */
    probe: () => Promise<boolean>;
    /** Injectable for tests. */
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

// Poll Grafana's health probe until it answers or the timeout elapses, so setup
// runs only once Grafana is actually ready (handles cold-deploy ordering).
export async function waitForGrafanaReady({
    timeoutMs,
    pollIntervalMs,
    probe,
    sleep,
    now
}: WaitForReadyOptions): Promise<boolean> {
    const wait =
        sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const clock = now ?? Date.now;
    const deadline = clock() + timeoutMs;
    let ready = await probe();
    while (!ready && clock() < deadline) {
        await wait(pollIntervalMs);
        ready = await probe();
    }
    return ready;
}
