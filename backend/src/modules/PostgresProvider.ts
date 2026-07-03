import exposeMethods from 'expose-sql-methods/lib/postgres';
import * as log4js from 'log4js';
import migration from 'migration-collection/lib/postgres';
import {Client, Pool, type PoolClient} from 'pg';
import type {config_rc_t} from '../config';
import {envInt} from '../config/envReader';
import {tuning} from '../config/tuning';
import type ShellyDeviceFactoryType from '../model/ShellyDeviceFactory';
import * as Observability from '../modules/Observability';
import {unwrapDefaultExport} from './dynamicImport';
import {getDeploymentTopology} from './identity';
import {
    MIGRATION_PATH_MARKER,
    migrationLedgerTable,
    normalizeMigrationLedgerName
} from './migrationLedger';
import {
    buildDbRuntimeErrorSnapshot,
    buildDbRuntimeSnapshot,
    getDbRuntimeSnapshot,
    readExpectedTimescaleImage,
    setDbRuntimeSnapshot
} from './observability/dbRuntime';
import {formatError} from './util/formatError';

const logger = log4js.getLogger('postgres');

export type get_resp_t = {
    external_id: string;
    created: Date;
    updated: Date;
    jdoc: any;
    control_access: number;
    id: number;
};

export const ACCESS_CONTROL = {
    PENDING: 1,
    DENIED: 2,
    ALLOWED: 3
} as const;

// make sure we hoist that and make it accessible everywhere
let callDbMethod: <T = any>(
    name: string,
    params: any,
    txId?: number
) => Promise<T>;

// Module-level reference so shutdown() can end the pg pool on SIGTERM.
let expDBInstance: any;
let queryPool: Pool | undefined;
let dbRuntimeRefreshTimer: NodeJS.Timeout | undefined;
let lastDbRuntimeWarning = '';

export interface PoolPressure {
    waitingCount: number;
    usage: number;
}

interface PoolStatsLike {
    totalCount?: number;
    idleCount?: number;
    waitingCount?: number;
}

// Pure pressure readout for a pg pool: usage is the busy fraction, waitingCount
// is queued clients. An absent or empty pool reads as no pressure.
export function poolPressureFromStats(
    stats: PoolStatsLike | undefined
): PoolPressure {
    if (
        !stats ||
        typeof stats.totalCount !== 'number' ||
        stats.totalCount === 0
    ) {
        return {waitingCount: 0, usage: 0};
    }
    const total = stats.totalCount;
    const idle = typeof stats.idleCount === 'number' ? stats.idleCount : 0;
    return {
        waitingCount:
            typeof stats.waitingCount === 'number' ? stats.waitingCount : 0,
        usage: (total - idle) / total
    };
}

// Pressure of the query/report pool. The em-sync catch-up brake watches this so
// it backs off when reports are blocked: report queries queue here whenever
// ingest saturates Postgres, so waitingCount > 0 means reports are suffering.
export function getQueryPoolPressure(): PoolPressure {
    return poolPressureFromStats(queryPool as PoolStatsLike | undefined);
}

export async function rawCall(name: string, params: any) {
    if (!callDbMethod) throw new Error('Database not ready');
    return callDbMethod(name, params);
}

// pg returns scalar SQL functions as a single-row, single-column object
// whose key matches the function name (e.g. `add_report_config: 42`).
// Renames or schema drift silently zero this out without a helper, so
// every scalar handler should funnel through this.
export function extractScalar(rows: readonly unknown[] | undefined): unknown {
    const row = rows?.[0];
    if (row === undefined || row === null) return undefined;
    if (typeof row !== 'object') return row;
    const values = Object.values(row as Record<string, unknown>);
    return values.length === 1
        ? values[0]
        : ((row as Record<string, unknown>).id ?? values[0]);
}

// Shape of a callMethod/rawCall result — one home for the repos that map it.
export interface DbResult {
    rows?: ReadonlyArray<Record<string, unknown>>;
}

// Scalar stored functions return one row, one column. These coerce that
// single value, defaulting when the result set is empty.
export function extractScalarNumber(result: unknown): number {
    const v = extractScalar((result as DbResult)?.rows);
    return typeof v === 'number' ? v : Number(v ?? 0);
}

export function extractScalarBoolean(result: unknown): boolean {
    const v = extractScalar((result as DbResult)?.rows);
    return v === true || v === 't' || v === 'true';
}

// Postgres surfaces statement_timeout cancellation as SQLSTATE 57014
// (query_canceled). Surface to ops via counter + rate-limited warn so a
// chronic timeout shows up in monitoring without log floods.
const PG_QUERY_CANCELED = '57014';
let lastTimeoutWarnTs = 0;
function recordPgQueryTimeout(sql: string): void {
    Observability.incrementCounter('pg_query_statement_timeout_total');
    const now = Date.now();
    if (now - lastTimeoutWarnTs > 60_000) {
        lastTimeoutWarnTs = now;
        const preview = sql.slice(0, 120).replace(/\s+/g, ' ');
        logger.warn('pg statement_timeout fired (preview=%s)', preview);
    }
}

export async function queryRows<T = any>(
    sql: string,
    params: readonly unknown[] = []
): Promise<T[]> {
    if (!queryPool) {
        // The under-test signal that the test forgot to install a pool stub.
        // Production callers see this only when initDatabase hasn't run.
        throw new Error(
            tuning.db.underNodeTest
                ? `queryRows called with no pool. In tests, call __setQueryPoolForTests({query: ...}) before exercising this code path. Failing SQL: ${sql.slice(0, 200)}`
                : 'Database not ready'
        );
    }
    const timed = Observability.getLevel() >= 2;
    const t0 = timed ? performance.now() : 0;
    try {
        const result = await queryPool.query(sql, [...params]);
        if (timed)
            Observability.recordDbTiming(
                'postgres.queryRows',
                performance.now() - t0
            );
        return result.rows as T[];
    } catch (err) {
        if ((err as {code?: string})?.code === PG_QUERY_CANCELED) {
            recordPgQueryTimeout(sql);
        }
        throw err;
    }
}

export interface QueryTxClient {
    query<T = any>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

// Minimal pg client surface used by the transaction body. Pulled out as an
// interface so the body is testable without a live pool.
export interface PgLikeClient {
    query(sql: string, params?: unknown[]): Promise<{rows: unknown[]}>;
    release(): void;
}

export interface PgLikePool {
    connect(): Promise<PgLikeClient>;
}

// BEGIN/COMMIT/ROLLBACK around a callback. Exported separately so tests can
// drive it with a fake pool.
export async function runInTransaction<T>(
    pool: PgLikePool,
    fn: (client: QueryTxClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    const tx: QueryTxClient = {
        async query<U = any>(
            sql: string,
            params?: readonly unknown[]
        ): Promise<U[]> {
            const result = await client.query(
                sql,
                params ? [...params] : undefined
            );
            return result.rows as U[];
        }
    };
    try {
        await client.query('BEGIN');
        // 0 = no cap. FM_DB_TX_STATEMENT_TIMEOUT_MS. Direct env keeps file leaf.
        const stmtTimeoutMs = envInt(
            'FM_DB_TX_STATEMENT_TIMEOUT_MS',
            30_000,
            0
        );
        if (stmtTimeoutMs > 0) {
            await client.query(
                `SET LOCAL statement_timeout = ${stmtTimeoutMs}`
            );
        }
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error if rollback also fails.
        }
        throw err;
    } finally {
        client.release();
    }
}

// Multi-statement transaction over the queryPool. Use when several
// queryRows calls must share a snapshot or hold an advisory lock.
export async function withQueryTransaction<T>(
    fn: (client: QueryTxClient) => Promise<T>
): Promise<T> {
    if (!queryPool) throw new Error('Database not ready');
    return runInTransaction(queryPool as unknown as PgLikePool, fn);
}

// Raw pooled client for streaming reads (COPY TO STDOUT). Wraps the work in a
// transaction so SET LOCAL statement_timeout (FM_EXPORT_STATEMENT_TIMEOUT_MS,
// 0 = no cap) is scoped to this borrow and never leaks onto the pooled
// connection. Always releases the client, even on error.
export async function withPooledClient<T>(
    fn: (client: PoolClient) => Promise<T>
): Promise<T> {
    if (!queryPool) throw new Error('Database not ready');
    const client = await queryPool.connect();
    try {
        await client.query('BEGIN');
        const timeoutMs = envInt('FM_EXPORT_STATEMENT_TIMEOUT_MS', 900_000, 0);
        if (timeoutMs > 0) {
            await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
        }
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error if rollback also fails.
        }
        throw err;
    } finally {
        client.release();
    }
}

// Test-only: install a fake pool so queryRows / withQueryTransaction can be
// driven without a live database. Pass undefined to clear. Production code
// must never call this.
export function __setQueryPoolForTests(
    fake:
        | {
              query: (
                  sql: string,
                  params: unknown[]
              ) => Promise<{rows: unknown[]}>;
          }
        | undefined
): void {
    queryPool = fake as unknown as Pool | undefined;
}

export function __setCallDbMethodForTests(
    fake:
        | (<T = any>(name: string, params: any, txId?: number) => Promise<T>)
        | undefined
): void {
    callDbMethod = fake as typeof callDbMethod;
}

export async function get(
    shellyID: string | null = null,
    controlAccess: number | null = null
): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod('device.fn_fetch', {
        p_external_id: shellyID,
        p_control_access: controlAccess || null
    });

    return result.rows;
}

export async function getBatch(shellyIDs: string[]): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (shellyIDs.length === 0) return [];
    const result = await callDbMethod('device.fn_fetch_batch', {
        p_external_ids: shellyIDs
    });
    return result.rows;
}

/**
 * Resolve a batch of shellyIDs to their internal DB row IDs.
 *
 * Phase 0b shared accessor — lets every component that needs an internal id
 * skip the duplicated `getBatch() -> row.id` filtering that FM and
 * DeviceComponent both open-code today.
 *
 * - Unknown shellyIDs are silently omitted from the returned map. Callers
 *   decide whether that is an error or simply a pruned input.
 * - `internalIds` and `idMap` are returned together so downstream code can
 *   both pass arrays into DB functions and render back to shellyIDs without
 *   a second query.
 */
export async function resolveDeviceIds(shellyIDs: string[]): Promise<{
    internalIds: number[];
    idMap: Record<number, string>;
}> {
    if (shellyIDs.length === 0) return {internalIds: [], idMap: {}};
    const rows = await getBatch(shellyIDs);
    const internalIds: number[] = [];
    const idMap: Record<number, string> = {};
    for (const row of rows) {
        if (typeof row.id === 'number') {
            internalIds.push(row.id);
            idMap[row.id] = row.external_id;
        }
    }
    return {internalIds, idMap};
}

export async function getPendingDevices() {
    return get(null, ACCESS_CONTROL.PENDING);
}

export async function getDeniedDevices() {
    return get(null, ACCESS_CONTROL.DENIED);
}

export async function accessControl(
    shellyID?: string,
    id?: number,
    controlAccess?: number,
    txId?: number
): Promise<get_resp_t | undefined> {
    if (!callDbMethod) throw new Error('Database not ready');
    const rows = (
        await callDbMethod(
            'device.fn_fetch',
            {
                p_external_id: shellyID,
                p_id: id,
                p_control_access: controlAccess
            },
            txId
        )
    ).rows;
    if (!rows[0]) return undefined;
    return rows[0] as get_resp_t;
}

export async function allowAccessControl(id: number, txId?: number) {
    return await callDbMethod<void>(
        'device.fn_control_access_allow',
        {p_id: id},
        txId
    );
}

/**
 * Batch admit / deny / quarantine for (externalId, jdoc) pairs.
 * p_control_access: 2=denied, 3=allowed (1=pending default).
 * organizationId stamps org in the same write; null for deny/quarantine.
 */
export async function admitBatch(
    admissions: Array<{externalId: string; jdoc?: unknown}>,
    controlAccess: 2 | 3,
    organizationId: string | null
): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (admissions.length === 0) return [];
    const payload = admissions.map(({externalId, jdoc}) => ({
        external_id: externalId,
        jdoc: jdoc ?? null
    }));
    const result = await callDbMethod('device.fn_admit_batch', {
        p_admissions: JSON.stringify(payload),
        p_control_access: controlAccess,
        p_organization_id: organizationId
    });
    return result.rows;
}

export async function getBatchByIds(ids: number[]): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (ids.length === 0) return [];
    const result = await callDbMethod('device.fn_fetch_batch_by_ids', {
        p_ids: ids
    });
    return result.rows;
}

// Atomic flip-control-access-and-return for a known set of device IDs.
// Closes the (allow_batch + fetch_batch) race where a concurrent delete
// between the two calls leaves DB control_access updated but the row
// missing from the caller's result — desynchronising the in-memory
// pending map.
export async function admitBatchByIds(
    ids: number[],
    controlAccess: 2 | 3,
    organizationId: string
): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (ids.length === 0) return [];
    const result = await callDbMethod('device.fn_admit_batch_by_ids', {
        p_ids: ids,
        p_control_access: controlAccess,
        p_organization_id: organizationId
    });
    return result.rows;
}

export async function denyAccessControl(id: number, txId?: number) {
    return await callDbMethod<void>(
        'device.fn_control_access_deny',
        {p_id: id},
        txId
    );
}

export async function userCheck(name: string, password: string) {
    return await callDbMethod<void>('user.fn_get', {
        p_name: name,
        p_password: password
    });
}

export async function userList({
    id,
    name,
    password
}: {
    id?: number;
    name?: string;
    password?: string;
}) {
    return await callDbMethod<{rows: any[]}>('user.fn_get', {
        p_id: id,
        p_name: name,
        p_password: password
    });
}

export async function deviceDelete(shellyID: string) {
    const device = (await get(shellyID))[0];
    if (!device) throw new Error(`Device ${shellyID} not found`);
    return await callDbMethod<void>('device.fn_full_delete', {
        p_id: device.id
    });
}

export async function store(shellyID: string, data: any, txId?: number) {
    if (!callDbMethod) throw new Error('Database not ready');
    return await callDbMethod(
        'device.fn_add',
        {p_external_id: shellyID, p_jdoc: data},
        txId
    );
}

export async function storeBatch(
    entries: ReadonlyArray<{externalId: string; jdoc: any}>,
    txId?: number
) {
    if (entries.length === 0) return {rows: []};
    if (!callDbMethod) throw new Error('Database not ready');
    return await callDbMethod(
        'device.fn_add_batch',
        {
            p_entries: entries.map((entry) => ({
                external_id: entry.externalId,
                jdoc: entry.jdoc
            }))
        },
        txId
    );
}
export async function callMethod(method: string, params: any, txId?: number) {
    if (!callDbMethod) {
        throw new Error(
            tuning.db.underNodeTest
                ? `callMethod called with no db stub. In tests, call __setCallDbMethodForTests(async (m, p) => ...) before exercising this code path. Failing SP: ${method}`
                : 'Database not ready'
        );
    }
    return await callDbMethod(method, params, txId);
}

const MIGRATION_ADVISORY_LOCK_KEY = 0x666c6d_6d6967; // "flm_mig"
// Clear leftover rows in migration.locks. The table is append-only —
// crashes can leave a count mismatch that blocks future runs, so we
// purge under the advisory lock before letting migration() proceed.
async function clearStaleMigrationLocks(
    client: Client,
    schema: string,
    database: string
): Promise<void> {
    try {
        const {rowCount} = await client.query(
            `DELETE FROM "${database}"."${schema}"."migration.locks"`
        );
        if (rowCount && rowCount > 0) {
            logger.info(
                'Cleared %d migration lock row(s) before migration run',
                rowCount
            );
        }
    } catch (err: any) {
        if (err?.code === '42P01') {
            logger.debug('migration.locks not present yet (first boot)');
        } else {
            logger.warn(
                'Stale-lock clear failed (continuing): %s',
                err?.message ?? String(err)
            );
        }
    }
}

async function normalizeMigrationLedgerNames(
    client: Client,
    schema: string,
    database: string
): Promise<void> {
    const table = migrationLedgerTable(database, schema);
    try {
        const {rows} = await client.query<{id: number; name: string}>(
            `SELECT id, name FROM ${table} WHERE name LIKE '%${MIGRATION_PATH_MARKER}%'`
        );
        let updated = 0;
        for (const row of rows) {
            const normalized = normalizeMigrationLedgerName(row.name);
            if (normalized === row.name) continue;
            const result = await client.query(
                `UPDATE ${table} SET name = $1 WHERE id = $2 AND name = $3`,
                [normalized, row.id, row.name]
            );
            updated += result.rowCount ?? 0;
        }
        if (updated > 0) {
            logger.info('Canonicalized %d migration ledger row(s)', updated);
        }
    } catch (err: any) {
        if (err?.code === '42P01') {
            logger.debug('migration.list not present yet (first boot)');
        } else {
            throw err;
        }
    }
}

// Acquire a postgres advisory lock, clear stale rows, run migrations,
// release the lock. Two processes booting concurrently serialize here
// (pg_advisory_lock blocks until the holder releases).
async function runMigrationsUnderLock(
    config: NonNullable<config_rc_t['internalStorage']>
): Promise<void> {
    const lockClient = new Client(config.connection);
    try {
        await lockClient.connect();
        await lockClient.query(
            `SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY})`
        );
        logger.debug('migration advisory lock acquired');

        await clearStaleMigrationLocks(
            lockClient,
            config.schema || 'migration',
            config.connection.database || 'fleet'
        );
        await normalizeMigrationLedgerNames(
            lockClient,
            config.schema || 'migration',
            config.connection.database || 'fleet'
        );

        const migrationStart = Date.now();
        try {
            await migration(config);
            logger.info(
                'Database migrations completed in %dms',
                Date.now() - migrationStart
            );
        } catch (err: any) {
            logger.error('Migration failed %s', err.message);
            throw err;
        }
    } finally {
        // Surface unlock failures — silent unlock leaves the session
        // lock held and can deadlock the next pod's boot.
        try {
            await lockClient.query(
                `SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`
            );
        } catch (err) {
            logger.warn(
                'pg_advisory_unlock failed — next boot may block on advisory lock: %s',
                formatError(err)
            );
        }
        try {
            await lockClient.end();
        } catch (err) {
            logger.warn(
                'migration lock client close failed: %s',
                formatError(err)
            );
        }
    }
}

// Build the closure stored in `callDbMethod`. Owns the magic-string `tx`
// branch (transaction-handle factory) and the per-call timing wrapper.
function buildCallDbMethod(
    expDB: Awaited<ReturnType<typeof exposeMethods<Record<string, any>>>>
): typeof callDbMethod {
    return async (name: string, params: any, txId?: number) => {
        const m = expDB.methods[name];
        if (!m) {
            if (name === 'tx') {
                return {
                    async begin() {
                        return await expDB.txBegin();
                    },
                    async end(id: number, query: string) {
                        return await expDB.txEnd(id, query);
                    }
                };
            }
            throw new Error('MethodNotFound');
        }
        const timed = Observability.getLevel() >= 2;
        const t0 = timed ? performance.now() : 0;
        const result = await m(params, txId);
        if (timed) Observability.recordDbTiming(name, performance.now() - t0);
        return result;
    };
}

function registerDbPoolStats(
    expDB: Awaited<ReturnType<typeof exposeMethods<Record<string, any>>>>
): void {
    try {
        type PoolStats = {
            totalCount: number;
            idleCount: number;
            waitingCount: number;
        };
        const db = expDB as {
            pool?: PoolStats;
            client?: {pool?: PoolStats};
        };
        const pool = db.pool ?? db.client?.pool;
        if (pool && typeof pool.totalCount === 'number') {
            Observability.registerModule('dbPool', {
                stats: () => {
                    const total = pool.totalCount;
                    const idle = pool.idleCount;
                    const usage = total > 0 ? (total - idle) / total : 0;
                    return {
                        totalCount: total,
                        idleCount: idle,
                        waitingCount: pool.waitingCount,
                        status:
                            usage > 0.9
                                ? 'critical'
                                : usage > 0.7
                                  ? 'warning'
                                  : 'healthy'
                    };
                },
                topology: {
                    role: 'sink',
                    cluster: 'storage',
                    upstreams: ['statusQueue', 'emSync', 'audit', 'geo'],
                    label: 'Database',
                    description: 'PostgreSQL connection pool',
                    route: '/monitoring/database'
                }
            });
        }
    } catch {
        /* pool stats not available — skip */
    }
}

function registerDbRuntimeStats(): void {
    Observability.registerModule('dbRuntime', {
        stats: () => {
            const snap = getDbRuntimeSnapshot();
            return {
                status: snap.status,
                statusCode: snap.statusCode,
                checkedAt: snap.checkedAt,
                checkAgeSeconds: snap.checkAgeSeconds,
                lastSuccessfulAt: snap.lastSuccessfulAt,
                lastSuccessfulAgeSeconds: snap.lastSuccessfulAgeSeconds,
                postgresVersion: snap.postgresVersion,
                postgresMajor: snap.postgresMajor,
                timescaleVersion: snap.timescaleVersion,
                expectedTimescaleImage: snap.expectedTimescaleImage,
                expectedTimescaleVersion: snap.expectedTimescaleVersion,
                error: snap.error
            };
        },
        topology: {
            role: 'sink',
            cluster: 'storage',
            upstreams: ['dbPool'],
            label: 'Database Runtime',
            description:
                'Live PostgreSQL and TimescaleDB runtime version check',
            route: '/monitoring/activity',
            criticality: 'high',
            dataClasses: ['runtime_identity']
        }
    });
}

async function refreshDbRuntimeStats(): Promise<void> {
    if (!queryPool) return;
    try {
        const [pgVersion, timescaleVersion] = await Promise.all([
            queryPool.query<{version: string}>(
                `SELECT current_setting('server_version') AS version`
            ),
            queryPool.query<{version: string}>(
                `SELECT COALESCE((SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'), '') AS version`
            )
        ]);
        const snap = buildDbRuntimeSnapshot({
            postgresVersion: pgVersion.rows[0]?.version ?? '',
            timescaleVersion: timescaleVersion.rows[0]?.version ?? '',
            expectedTimescaleImage: readExpectedTimescaleImage()
        });
        setDbRuntimeSnapshot(snap);
        Observability.setGauge('db_runtime_status', snap.statusCode);
        Observability.setGauge(
            'db_runtime_timescale_match',
            snap.status === 'ok' ? 1 : snap.status === 'unknown' ? -1 : 0
        );
        Observability.setGauge('db_runtime_postgres_major', snap.postgresMajor);
        const warningKey = `${snap.status}:${snap.timescaleVersion}:${snap.expectedTimescaleVersion}`;
        if (
            (snap.status === 'stale' || snap.status === 'mismatch') &&
            warningKey !== lastDbRuntimeWarning
        ) {
            lastDbRuntimeWarning = warningKey;
            logger.warn(
                'DB runtime version mismatch: expected TimescaleDB %s from %s, actual extension is %s',
                snap.expectedTimescaleVersion || 'unknown',
                snap.expectedTimescaleImage || 'manifest unavailable',
                snap.timescaleVersion || 'missing'
            );
        }
    } catch (err) {
        const snap = buildDbRuntimeErrorSnapshot(formatError(err));
        setDbRuntimeSnapshot(snap);
        Observability.setGauge('db_runtime_status', snap.statusCode);
        Observability.setGauge('db_runtime_timescale_match', 0);
        logger.warn('DB runtime version check failed: %s', snap.error);
    }
}

function startDbRuntimeRefresh(): void {
    void refreshDbRuntimeStats();
    if (dbRuntimeRefreshTimer) return;
    dbRuntimeRefreshTimer = setInterval(
        () => void refreshDbRuntimeStats(),
        5 * 60 * 1000
    );
    dbRuntimeRefreshTimer.unref?.();
}

export async function initDatabase(
    storageConfig: config_rc_t['internalStorage']
) {
    logger.debug('init started');
    // Shallow copy so reassigning .cwd below doesn't mutate the caller's
    // config. Nested .connection is intentionally shared with the caller.
    const config = Object.assign({}, storageConfig);

    if (!config || Object.keys(config).length === 0) {
        logger.warn('init config error, no postgres config found');
        return;
    }

    if (config?.cwd) {
        await runMigrationsUnderLock(config);
    }

    const expConfig = {...config, schemas: config.link.schemas};
    const expDB = await exposeMethods<Record<string, any>>(expConfig, {
        log: (level: 'error' | 'info' | 'warn', ...rest: [any]) => {
            logger[level](...rest);
        }
    });
    expDBInstance = expDB;
    // 0 disables; tx path uses FM_DB_TX_STATEMENT_TIMEOUT_MS, same idea.
    const queryTimeoutMs = envInt(
        'FM_DB_QUERY_STATEMENT_TIMEOUT_MS',
        30_000,
        0
    );
    queryPool = new Pool({
        ...config.connection,
        ...(queryTimeoutMs > 0 ? {statement_timeout: queryTimeoutMs} : {})
    });
    // Without a listener, idle-client errors become uncaughtException.
    // Rate-limit logs so a flapping pool can't spam stdout; counter is
    // the durable signal for ops dashboards.
    let lastIdleErrLog = 0;
    queryPool.on('error', (err) => {
        Observability.incrementCounter('pg_pool_idle_errors');
        const now = Date.now();
        if (now - lastIdleErrLog > 30_000) {
            lastIdleErrLog = now;
            logger.warn('pg pool idle-client error', err);
        }
    });
    callDbMethod = buildCallDbMethod(expDB);
    registerDbPoolStats(expDB);
    registerDbRuntimeStats();
    startDbRuntimeRefresh();

    logger.debug('init finished');
}

// ==================== DEVICE↔ORG LINK ====================

export async function setDeviceOrganization(
    externalId: string,
    organizationId: string
): Promise<void> {
    if (!callDbMethod) throw new Error('Database not ready');
    await callDbMethod<{rows: unknown[]}>('device.fn_list_set_organization', {
        p_external_id: externalId,
        p_organization_id: organizationId
    });
}

/**
 * Batch counterpart of setDeviceOrganization. One round-trip for all ids.
 * Returns the external_ids that matched a row (others were unknown to FM).
 */
export async function setDeviceOrganizationBatch(
    externalIds: string[],
    organizationId: string
): Promise<string[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (externalIds.length === 0) return [];
    const result = await callDbMethod<{rows: Array<{external_id: string}>}>(
        'device.fn_list_set_organization_batch',
        {
            p_external_ids: externalIds,
            p_organization_id: organizationId
        }
    );
    return result.rows.map((r) => r.external_id);
}

export async function listDeviceOrganizationPairs(): Promise<
    Array<{external_id: string; organization_id: string}>
> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{
        rows: {external_id: string; organization_id: string}[];
    }>('device.fn_list_organization_pairs', {});
    return result.rows;
}

// ==================== GROUP HELPERS (new organization.* schema) ====================

export interface DeviceMembershipRow {
    subject_id: string;
    group_ids: number[];
    location_id: number | null;
    tag_ids: number[];
    tag_keys: string[];
}

export interface LocationParentRow {
    id: number;
    parent_location_id: number | null;
}

/** Per-device groups+location+tags in one round-trip. */
export async function listDeviceMemberships(
    organizationId: string
): Promise<DeviceMembershipRow[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: DeviceMembershipRow[]}>(
        'organization.fn_device_memberships',
        {p_organization_id: organizationId}
    );
    return result.rows;
}

/** Source-of-truth shellyID set for an org — bounds `scope: 'ALL'` to caller's org. */
export async function listOrgDevices(
    organizationId: string
): Promise<string[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: Array<{external_id: string}>}>(
        'device.fn_list_shelly_ids_by_org',
        {p_organization_id: organizationId}
    );
    return result.rows.map((r) => r.external_id);
}

/** Location id to parent id for hierarchy-aware permission checks. */
export async function listLocationParents(
    organizationId: string
): Promise<LocationParentRow[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const LIMIT = envInt('FM_LOCATION_PARENTS_MAX_ROWS', 10_000, 100);
    const result = await callDbMethod<{
        rows: Array<LocationParentRow & {total_count?: number | string}>;
    }>('organization.fn_location_list', {
        p_organization_id: organizationId,
        p_parent_id: null,
        p_roots_only: false,
        p_limit: LIMIT,
        p_offset: 0,
        p_allowed_ids: null,
        p_include_summary: false
    });
    const rows = result.rows ?? [];
    if (rows.length >= LIMIT) {
        logger.warn(
            'listLocationParents hit limit=%d for org %s — hierarchy may be incomplete',
            LIMIT,
            organizationId
        );
    }
    return rows
        .filter((r) => typeof r.id === 'number')
        .map((r) => ({
            id: r.id,
            parent_location_id: r.parent_location_id ?? null
        }));
}

/** Flat device-membership lookup for access-control reverse index. */
export async function listGroupDeviceMemberships(
    organizationId: string,
    groupIds?: number[]
): Promise<Array<{group_id: number; subject_id: string}>> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{
        rows: {group_id: number; subject_id: string}[];
    }>('organization.fn_group_device_memberships', {
        p_organization_id: organizationId,
        p_group_ids: groupIds ?? null
    });
    return result.rows;
}

/** Add device subjects to a group (used by WaitingRoomComponent on approve). */
export async function groupAddDevicesBatch(
    organizationId: string,
    groupId: number,
    shellyIds: string[]
): Promise<number> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (shellyIds.length === 0) return 0;
    const subjectTypes = new Array(shellyIds.length).fill('device');
    const result = await callDbMethod<{rows: unknown[]}>(
        'organization.fn_group_add_members_batch',
        {
            p_organization_id: organizationId,
            p_group_id: groupId,
            p_subject_types: subjectTypes,
            p_subject_ids: shellyIds
        }
    );
    return result.rows?.length ?? 0;
}

// ==================== VIRTUAL COMPONENT DECORATION META ====================

export interface VirtualMetadataRow {
    organization_id: string;
    host_shelly_id: string;
    component_key: string;
    glyph: string | null;
    color: string | null;
    gradient: Record<string, unknown> | null;
    promoted_at: string | null;
    image_path: string | null;
    measurement: Record<string, unknown> | null;
    created: string;
    updated: string;
}

interface VirtualMetaTarget {
    organizationId: string;
    hostShellyId: string;
    componentKey: string;
}

interface VirtualMetaSetFields {
    glyph?: string | null;
    color?: string | null;
    gradient?: Record<string, unknown> | null;
    promotedAt?: Date | null;
    imagePath?: string | null;
    /** Typed at the API boundary; persisted opaquely as JSONB. */
    measurement?: object | null;
}

interface VirtualMetaClearFlags {
    clearGlyph?: boolean;
    clearColor?: boolean;
    clearGradient?: boolean;
    clearPromoted?: boolean;
    clearImage?: boolean;
    clearMeasurement?: boolean;
}

export async function virtualMetaSet(
    target: VirtualMetaTarget,
    fields: VirtualMetaSetFields
): Promise<VirtualMetadataRow> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: VirtualMetadataRow[]}>(
        'device.fn_virtual_meta_set',
        {
            p_organization_id: target.organizationId,
            p_host_shelly_id: target.hostShellyId,
            p_component_key: target.componentKey,
            p_glyph: fields.glyph ?? null,
            p_color: fields.color ?? null,
            p_gradient: fields.gradient ?? null,
            p_promoted_at: fields.promotedAt ?? null,
            p_image_path: fields.imagePath ?? null,
            p_measurement: fields.measurement ?? null
        }
    );
    const row = result.rows[0];
    if (!row) throw new Error('virtualMetaSet returned no row');
    return row;
}

export async function virtualMetaClear(
    target: VirtualMetaTarget,
    flags: VirtualMetaClearFlags
): Promise<VirtualMetadataRow | null> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: VirtualMetadataRow[]}>(
        'device.fn_virtual_meta_clear',
        {
            p_organization_id: target.organizationId,
            p_host_shelly_id: target.hostShellyId,
            p_component_key: target.componentKey,
            p_clear_glyph: flags.clearGlyph ?? false,
            p_clear_color: flags.clearColor ?? false,
            p_clear_gradient: flags.clearGradient ?? false,
            p_clear_promoted: flags.clearPromoted ?? false,
            p_clear_image: flags.clearImage ?? false,
            p_clear_measurement: flags.clearMeasurement ?? false
        }
    );
    return result.rows[0] ?? null;
}

export async function virtualMetaDelete(
    target: VirtualMetaTarget
): Promise<void> {
    if (!callDbMethod) throw new Error('Database not ready');
    await callDbMethod('device.fn_virtual_meta_delete', {
        p_organization_id: target.organizationId,
        p_host_shelly_id: target.hostShellyId,
        p_component_key: target.componentKey
    });
}

export async function virtualMetaFetch(
    organizationId: string,
    hostShellyId: string
): Promise<VirtualMetadataRow[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: VirtualMetadataRow[]}>(
        'device.fn_virtual_meta_fetch',
        {
            p_organization_id: organizationId,
            p_host_shelly_id: hostShellyId
        }
    );
    return result.rows;
}

export async function virtualMetaListPromoted(
    organizationId: string
): Promise<VirtualMetadataRow[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: VirtualMetadataRow[]}>(
        'device.fn_virtual_meta_list_promoted',
        {p_organization_id: organizationId}
    );
    return result.rows;
}

// Runs legacy-snapshot method backfills with bounded concurrency so a 10k-
// device boot doesn't fan out 10k pg writes at once. Errors per row are
// logged and skipped; returns the count of rows successfully written.
async function runBoundedBackfills(
    backfills: ReadonlyArray<{externalId: string; jdoc: any}>
): Promise<number> {
    if (backfills.length === 0) return 0;
    const CONCURRENCY = envInt('FM_BOOT_BACKFILL_CONCURRENCY', 16, 1);
    let written = 0;
    for (let i = 0; i < backfills.length; i += CONCURRENCY) {
        const chunk = backfills.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
            chunk.map((b) => store(b.externalId, b.jdoc))
        );
        for (let j = 0; j < results.length; j++) {
            const r = results[j];
            if (r.status === 'fulfilled') {
                written++;
            } else {
                logger.warn(
                    'failed to backfill methods id=[%s] err=[%s]',
                    chunk[j].externalId,
                    String(r.reason)
                );
            }
        }
    }
    return written;
}

export async function loadSavedDevices() {
    const pinnedOrg = getDeploymentTopology().clientOrgId;
    let allowedSet: Set<string> | null = null;
    if (pinnedOrg) {
        allowedSet = new Set(await listOrgDevices(pinnedOrg));
        logger.info(
            'FM pinned to org %s — boot loading %d device(s)',
            pinnedOrg,
            allowedSet.size
        );
    }
    const devices = await get();
    logger.info('found %s saved devices', devices.length);
    let registered = 0;
    let skippedForeign = 0;
    const ShellyDeviceFactory = unwrapDefaultExport<
        typeof ShellyDeviceFactoryType
    >(await import('../model/ShellyDeviceFactory.js'));
    const DeviceCollector = await import('../modules/DeviceCollector.js');
    // Defer legacy-snapshot backfills so the boot loop is pure reads; the
    // writes run concurrently (pool-bounded) after every device is in
    // memory. A 10k-device boot used to block on N serial writes.
    const backfills: Array<{externalId: string; jdoc: any}> = [];
    for (const external of devices) {
        if (allowedSet && !allowedSet.has(external.external_id)) {
            skippedForeign++;
            continue;
        }
        try {
            const device = ShellyDeviceFactory.fromDatabase(external);
            if (device) {
                DeviceCollector.register(device);
                registered++;
                const stored = (external.jdoc as {methods?: unknown}).methods;
                const stale = !Array.isArray(stored) || stored.length === 0;
                if (stale && device.methods.length > 0) {
                    backfills.push({
                        externalId: external.external_id,
                        jdoc: {...external.jdoc, methods: device.methods}
                    });
                }
            } else {
                logger.warn(
                    'Cannot create device from db entry id=[%s]',
                    external.external_id
                );
            }
        } catch (error) {
            logger.warn(
                'failed to load saved device id=[%s] err=[%s]',
                external.external_id,
                String(error)
            );
        }
    }
    const backfilledMethods = await runBoundedBackfills(backfills);
    if (backfilledMethods > 0) {
        logger.info(
            'Backfilled methods on %d device row(s) (legacy snapshots).',
            backfilledMethods
        );
    }

    if (registered < devices.length - skippedForeign) {
        logger.warn(
            'failed to load %s saved devices',
            devices.length - registered - skippedForeign
        );
    }
    if (skippedForeign > 0) {
        logger.info(
            'skipped %s device(s) outside FM_CLIENT_ORG_ID',
            skippedForeign
        );
    }
}

/** Build a libpq connection string from the storage config. */
export function buildConnectionString(
    storageConfig: config_rc_t['internalStorage']
): string | undefined {
    const c = storageConfig?.connection;
    if (!c) return undefined;
    const user = encodeURIComponent(c.user);
    const pwd = encodeURIComponent(c.password ?? '');
    const host = c.host;
    const port = c.port ?? 5432;
    const db = encodeURIComponent(c.database);
    return `postgres://${user}:${pwd}@${host}:${port}/${db}`;
}

// Release the pg pool on SIGTERM. Prevents orphan Postgres connections
// when the process exits before GC finalizers run.
export async function shutdown(): Promise<void> {
    if (dbRuntimeRefreshTimer) {
        clearInterval(dbRuntimeRefreshTimer);
        dbRuntimeRefreshTimer = undefined;
    }
    if (queryPool) {
        try {
            await queryPool.end();
        } catch (err) {
            logger.warn('query pool stop() failed: %s', err);
        }
    }
    if (expDBInstance?.stop) {
        try {
            await expDBInstance.stop();
        } catch (err) {
            logger.warn('expose-sql-methods stop() failed: %s', err);
        }
    }
    queryPool = undefined;
    expDBInstance = undefined;
}
