import {SingleFlight} from '../singleFlight';

export const DEVICE_USAGE_WINDOW_DAYS = 30;
export const DEVICE_USAGE_CACHE_TTL_MS = 60_000;

type QueryRowsFn = <T = any>(
    sql: string,
    params?: readonly unknown[]
) => Promise<T[]>;

export type ClientDeviceLimitStatus =
    | 'ok'
    | 'warning'
    | 'over_limit'
    | 'not_available';

export interface ClientDeviceUsageRow {
    clientId: string;
    uniqueDevices: number;
    paidLimit: number | null;
    usageRatio: number | null;
    limitStatus: ClientDeviceLimitStatus;
}

interface DbClientDeviceUsageRow {
    client_id: string | null;
    unique_devices: string | number | null;
    paid_limit: string | number | null;
}

export interface ClientDeviceUsageDeps {
    queryRows?: QueryRowsFn;
}

export interface ClientDeviceUsageSnapshot {
    rows: ClientDeviceUsageRow[];
    queryAvailable: boolean;
    staleAgeSeconds: number;
    source: 'live' | 'cache' | 'unavailable';
}

export interface ClientDeviceUsageApiResponse {
    schema_version: 1;
    generated_at: string;
    window_days: number;
    query_available: boolean;
    stale_age_s: number;
    source: ClientDeviceUsageSnapshot['source'];
    clients: Array<{
        client_id: string;
        environment_id: string;
        unique_active_devices: number;
        paid_device_limit: number | null;
        usage_ratio: number | null;
        status: ClientDeviceLimitStatus;
    }>;
}

interface CachedClientDeviceUsage {
    rows: ClientDeviceUsageRow[];
    refreshedAtMs: number;
}

let cachedDeviceUsage: CachedClientDeviceUsage | null = null;

// Coalesce concurrent refreshes so the admin route and Prometheus scrape can't
// both fire the heavy COUNT(DISTINCT) on a shared cache miss.
const refreshInflight = new SingleFlight<'all', CachedClientDeviceUsage>(
    'client_device_usage'
);

const CLIENT_DEVICE_USAGE_SQL = `
WITH usage AS (
    SELECT
        COALESCE(NULLIF(organization_id, ''), 'unassigned') AS client_id,
        COUNT(DISTINCT external_id)::integer AS unique_devices
    FROM device.list
    WHERE COALESCE(kind, 'physical') = 'physical'
      AND control_access = 3
      AND COALESCE(updated, created) >= NOW() - INTERVAL '30 days'
      AND LOWER(COALESCE(
            jdoc #>> '{fleet,environment}',
            jdoc #>> '{billing,environment}',
            jdoc #>> '{plan,environment}',
            jdoc ->> 'environment',
            'production'
          )) NOT IN ('test', 'demo', 'internal', 'synthetic', 'virtual')
      AND LOWER(COALESCE(
            jdoc #>> '{billing,exclude_from_device_usage}',
            jdoc #>> '{billing,excludeFromDeviceUsage}',
            jdoc #>> '{fleet,synthetic}',
            jdoc #>> '{flags,synthetic}',
            jdoc #>> '{flags,virtual_only}',
            jdoc #>> '{flags,virtualOnly}',
            'false'
          )) NOT IN ('true', '1', 'yes')
    GROUP BY 1
),
raw_limits AS (
    SELECT
        id AS client_id,
        COALESCE(
            metadata #>> '{billing,device_limit}',
            metadata #>> '{billing,deviceLimit}',
            metadata #>> '{plan,device_limit}',
            metadata #>> '{plan,deviceLimit}',
            metadata ->> 'device_limit',
            metadata ->> 'deviceLimit'
        ) AS raw_paid_limit
    FROM organization.profile
),
limits AS (
    SELECT
        client_id,
        CASE
            WHEN raw_paid_limit ~ '^[0-9]+$' THEN raw_paid_limit::integer
            ELSE NULL
        END AS paid_limit
    FROM raw_limits
),
clients AS (
    SELECT client_id FROM usage
    UNION
    SELECT client_id FROM limits
)
SELECT
    clients.client_id,
    COALESCE(usage.unique_devices, 0)::integer AS unique_devices,
    limits.paid_limit
FROM clients
LEFT JOIN usage USING (client_id)
LEFT JOIN limits USING (client_id)
ORDER BY clients.client_id
`;

const DEVICE_LIMIT_WARNING_THRESHOLD = 0.9;

// queryRows is injected at startup so this module never imports
// PostgresProvider; that import would close a cycle back through Observability.
let registeredQueryRows: QueryRowsFn | undefined;

export function registerClientDeviceUsageQuery(queryRows: QueryRowsFn): void {
    registeredQueryRows = queryRows;
}

function toNumber(value: string | number | null | undefined): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function toOptionalNumber(
    value: string | number | null | undefined
): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = toNumber(value);
    return parsed > 0 ? parsed : null;
}

export function classifyDeviceLimitStatus(
    uniqueDevices: number,
    paidLimit: number | null
): ClientDeviceLimitStatus {
    if (!paidLimit) return 'not_available';
    if (uniqueDevices > paidLimit) return 'over_limit';
    if (uniqueDevices / paidLimit >= DEVICE_LIMIT_WARNING_THRESHOLD) {
        return 'warning';
    }
    return 'ok';
}

function usageRatio(
    uniqueDevices: number,
    paidLimit: number | null
): number | null {
    if (!paidLimit) return null;
    return uniqueDevices / paidLimit;
}

export function normalizeClientDeviceUsageRow(
    row: DbClientDeviceUsageRow
): ClientDeviceUsageRow {
    const uniqueDevices = toNumber(row.unique_devices);
    const paidLimit = toOptionalNumber(row.paid_limit);
    return {
        clientId: row.client_id || 'unassigned',
        uniqueDevices,
        paidLimit,
        usageRatio: usageRatio(uniqueDevices, paidLimit),
        limitStatus: classifyDeviceLimitStatus(uniqueDevices, paidLimit)
    };
}

export async function readClientDeviceUsageRows(
    deps: ClientDeviceUsageDeps = {}
): Promise<ClientDeviceUsageRow[]> {
    const runQuery = deps.queryRows ?? registeredQueryRows;
    if (!runQuery) {
        throw new Error(
            'client device-usage query not registered — call registerClientDeviceUsageQuery at startup'
        );
    }
    const rows = await runQuery<DbClientDeviceUsageRow>(
        CLIENT_DEVICE_USAGE_SQL
    );
    return rows.map(normalizeClientDeviceUsageRow);
}

function cacheHitSnapshot(
    cache: CachedClientDeviceUsage,
    nowMs: number,
    queryAvailable: boolean
): ClientDeviceUsageSnapshot {
    return {
        rows: cache.rows,
        queryAvailable,
        staleAgeSeconds: Math.floor((nowMs - cache.refreshedAtMs) / 1000),
        source: 'cache'
    };
}

async function refreshClientDeviceUsage(
    deps: ClientDeviceUsageDeps,
    nowMs: number
): Promise<CachedClientDeviceUsage> {
    const rows = await readClientDeviceUsageRows(deps);
    cachedDeviceUsage = {rows, refreshedAtMs: nowMs};
    return cachedDeviceUsage;
}

export async function readClientDeviceUsageSnapshot(
    deps: ClientDeviceUsageDeps = {},
    nowMs = Date.now()
): Promise<ClientDeviceUsageSnapshot> {
    if (
        cachedDeviceUsage &&
        nowMs - cachedDeviceUsage.refreshedAtMs < DEVICE_USAGE_CACHE_TTL_MS
    ) {
        return cacheHitSnapshot(cachedDeviceUsage, nowMs, true);
    }

    try {
        const refreshed = await refreshInflight.run('all', () =>
            refreshClientDeviceUsage(deps, nowMs)
        );
        return {
            rows: refreshed.rows,
            queryAvailable: true,
            staleAgeSeconds: 0,
            source: 'live'
        };
    } catch {
        if (cachedDeviceUsage) {
            return cacheHitSnapshot(cachedDeviceUsage, nowMs, false);
        }
        return {
            rows: [],
            queryAvailable: false,
            staleAgeSeconds: -1,
            source: 'unavailable'
        };
    }
}

export function toClientDeviceUsageApiResponse(
    snapshot: ClientDeviceUsageSnapshot,
    environmentId: string,
    generatedAt = new Date().toISOString()
): ClientDeviceUsageApiResponse {
    return {
        schema_version: 1,
        generated_at: generatedAt,
        window_days: DEVICE_USAGE_WINDOW_DAYS,
        query_available: snapshot.queryAvailable,
        stale_age_s: snapshot.staleAgeSeconds,
        source: snapshot.source,
        clients: snapshot.rows.map((row) => ({
            client_id: row.clientId,
            environment_id: environmentId || 'unknown',
            unique_active_devices: row.uniqueDevices,
            paid_device_limit: row.paidLimit,
            usage_ratio: row.usageRatio,
            status: row.limitStatus
        }))
    };
}

export function __resetClientDeviceUsageCacheForTests(): void {
    cachedDeviceUsage = null;
}
