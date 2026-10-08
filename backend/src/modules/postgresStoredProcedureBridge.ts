import type {Pool, PoolClient, QueryResult, QueryResultRow} from 'pg';
import {
    type DbCallTiming,
    markDbCall,
    runWithDbCallTiming,
    sendDbQuery
} from './dbCallTiming';
import {
    finishDbCall,
    isDbCallDetailOn,
    startDbCall,
    timeDbCall
} from './Observability';
import {assertNoOpenTransaction} from './postgresTransactionScope';

const PROCEDURE_CATALOG_SQL = `
SELECT
    n.nspname AS schema,
    p.proname AS name,
    p.proargnames AS argnames,
    p.proargmodes AS argmodes,
    p.proargnames[p.pronargs - p.pronargdefaults + 1:p.pronargs]
        AS optargnames,
    pg_get_expr(p.proargdefaults, 0) AS optargdefaults
FROM pg_catalog.pg_namespace n
JOIN pg_catalog.pg_proc p ON p.pronamespace = n.oid
WHERE n.nspname = ANY($1::text[])
`;

type ProcedureParams = Readonly<Record<string, unknown>>;
type TransactionAction = 'COMMIT' | 'ROLLBACK';

export interface StoredProcedureCatalogRow extends QueryResultRow {
    schema: string;
    name: string;
    argnames: string[] | null;
    argmodes: string[] | string | null;
    optargnames: string[] | null;
    optargdefaults: string | null;
}

export interface StoredProcedureDefinition {
    readonly sqlName: string;
    readonly inputNames: readonly string[];
    readonly nullableDefaultNames: ReadonlySet<string>;
}

export interface DatabasePoolStats {
    readonly total: number;
    readonly idle: number;
    readonly waiting: number;
}

export interface DatabasePoolCountSource {
    readonly totalCount: number;
    readonly idleCount: number;
    readonly waitingCount: number;
}

export type StoredProcedureBridgeErrorCode =
    | 'DB_METHOD_NOT_FOUND'
    | 'DB_REQUIRED_ARGUMENT_NOT_FOUND'
    | 'DB_TRANSACTION_NOT_FOUND'
    | 'DB_TRANSACTION_ACTION_INVALID'
    | 'DB_BRIDGE_STOPPED';

export class StoredProcedureBridgeError extends Error {
    readonly code: StoredProcedureBridgeErrorCode;
    readonly details: Readonly<Record<string, string | number>>;

    constructor(
        code: StoredProcedureBridgeErrorCode,
        details: Readonly<Record<string, string | number>> = {}
    ) {
        super(code);
        this.name = 'StoredProcedureBridgeError';
        this.code = code;
        this.details = details;
    }
}

export interface PostgresStoredProcedureBridge {
    call<T extends QueryResultRow = QueryResultRow>(
        method: string,
        params?: ProcedureParams,
        txId?: number
    ): Promise<QueryResult<T>>;
    // The label names the code that opened the transaction.
    beginTransaction(label?: string): Promise<number>;
    endTransaction(id: number, action: TransactionAction): Promise<void>;
    poolStats(): DatabasePoolStats;
    stop(): Promise<void>;
}

export interface PostgresStoredProcedureBridgeOptions {
    readonly pool: Pool;
    readonly schemas: readonly string[];
    readonly gluePrefix?: string;
    readonly onPoolError?: (error: Error) => void;
}

function quoteIdentifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
}

function parseArgumentModes(raw: string[] | string | null): string[] | null {
    if (raw === null) return null;
    if (Array.isArray(raw)) return raw;
    return raw.replaceAll('{', '').replaceAll('}', '').split(',');
}

function inputArgumentNames(row: StoredProcedureCatalogRow): readonly string[] {
    if (!row.argnames) return [];
    const modes = parseArgumentModes(row.argmodes);
    if (!modes) return row.argnames;
    return row.argnames.filter((_, index) => modes[index] === 'i');
}

function nullableDefaultNames(
    row: StoredProcedureCatalogRow
): ReadonlySet<string> {
    if (!row.optargnames || !row.optargdefaults) return new Set();
    const defaults = row.optargdefaults.split(', ');
    return new Set(
        row.optargnames.filter((_, index) =>
            defaults[index]?.startsWith('NULL')
        )
    );
}

export function buildStoredProcedureDefinition(
    row: StoredProcedureCatalogRow
): StoredProcedureDefinition {
    return {
        sqlName: `${quoteIdentifier(row.schema)}.${quoteIdentifier(row.name)}`,
        inputNames: inputArgumentNames(row),
        nullableDefaultNames: nullableDefaultNames(row)
    };
}

export function buildStoredProcedureCatalog(
    rows: readonly StoredProcedureCatalogRow[],
    gluePrefix: string
): ReadonlyMap<string, StoredProcedureDefinition> {
    const procedures = new Map<string, StoredProcedureDefinition>();
    for (const row of rows) {
        procedures.set(
            `${row.schema}${gluePrefix}${row.name}`,
            buildStoredProcedureDefinition(row)
        );
    }
    return procedures;
}

async function discoverProcedures(
    pool: Pool,
    schemas: readonly string[],
    gluePrefix: string
): Promise<ReadonlyMap<string, StoredProcedureDefinition>> {
    const result = await pool.query<StoredProcedureCatalogRow>(
        PROCEDURE_CATALOG_SQL,
        [[...schemas]]
    );
    return buildStoredProcedureCatalog(result.rows, gluePrefix);
}

export function bindStoredProcedureArguments(
    method: string,
    definition: StoredProcedureDefinition,
    params: ProcedureParams
): unknown[] {
    return definition.inputNames.map((name) => {
        const value = params[name];
        if (value !== undefined) return value;
        if (definition.nullableDefaultNames.has(name)) return null;
        throw new StoredProcedureBridgeError('DB_REQUIRED_ARGUMENT_NOT_FOUND', {
            method,
            argument: name
        });
    });
}

export function buildStoredProcedureSql(
    definition: StoredProcedureDefinition
): string {
    const placeholders = definition.inputNames
        .map((_, index) => `$${index + 1}`)
        .join(',');
    return `SELECT * FROM ${definition.sqlName}(${placeholders})`;
}

export function readDatabasePoolStats(
    source: DatabasePoolCountSource
): DatabasePoolStats {
    return Object.freeze({
        total: source.totalCount,
        idle: source.idleCount,
        waiting: source.waitingCount
    });
}

function assertActive(stopped: boolean): void {
    if (stopped) {
        throw new StoredProcedureBridgeError('DB_BRIDGE_STOPPED');
    }
}

export async function createPostgresStoredProcedureBridge(
    options: PostgresStoredProcedureBridgeOptions
): Promise<PostgresStoredProcedureBridge> {
    const pool = options.pool;
    if (options.onPoolError) pool.on('error', options.onPoolError);

    const procedures = await discoverProcedures(
        pool,
        options.schemas,
        options.gluePrefix ?? '.'
    );

    const transactions = new Map<number, PoolClient>();
    // A transaction's timing ends when its connection goes back to the pool.
    const transactionTimings = new Map<number, DbCallTiming>();
    const finishTransactionTiming = (id: number): void => {
        const timing = transactionTimings.get(id);
        if (!timing) return;
        transactionTimings.delete(id);
        finishDbCall(timing);
    };
    const pendingTransactions = new Set<Promise<number>>();
    let nextTransactionId = 0;
    let stopped = false;

    return {
        async call<T extends QueryResultRow = QueryResultRow>(
            method: string,
            params: ProcedureParams = {},
            txId?: number
        ): Promise<QueryResult<T>> {
            assertActive(stopped);
            const definition = procedures.get(method);
            if (!definition) {
                throw new StoredProcedureBridgeError('DB_METHOD_NOT_FOUND', {
                    method
                });
            }
            const args = bindStoredProcedureArguments(
                method,
                definition,
                params
            );
            const sql = buildStoredProcedureSql(definition);
            if (!txId) {
                assertNoOpenTransaction('main', method);
                return await timeDbCall(
                    {path: 'procedure', method: () => method},
                    (timing) =>
                        runWithDbCallTiming(timing, () =>
                            sendDbQuery<QueryResult<T>>(pool, sql, args, timing)
                        )
                );
            }

            const client = transactions.get(txId);
            if (!client) {
                throw new StoredProcedureBridgeError(
                    'DB_TRANSACTION_NOT_FOUND',
                    {method, txId}
                );
            }
            return await timeDbCall(
                {path: 'procedure', method: () => method},
                (timing) =>
                    sendDbQuery<QueryResult<T>>(client, sql, args, timing)
            );
        },

        async beginTransaction(label = 'unlabeled'): Promise<number> {
            assertActive(stopped);
            assertNoOpenTransaction('main', 'BEGIN');
            const id = ++nextTransactionId;
            const timing = isDbCallDetailOn()
                ? startDbCall(`tx:${label}`, 'procedure')
                : undefined;
            const pending = (async () => {
                const client = await runWithDbCallTiming(timing, () =>
                    pool.connect()
                );
                markDbCall(timing, 'checkoutResumedAt');
                let released = false;
                try {
                    assertActive(stopped);
                    await client.query('BEGIN');
                    if (stopped) {
                        await client.query('ROLLBACK');
                        client.release();
                        released = true;
                        throw new StoredProcedureBridgeError(
                            'DB_BRIDGE_STOPPED'
                        );
                    }
                    transactions.set(id, client);
                    if (timing) transactionTimings.set(id, timing);
                    return id;
                } catch (error) {
                    if (!released) {
                        client.release(error instanceof Error ? error : true);
                    }
                    throw error;
                }
            })();
            pendingTransactions.add(pending);
            try {
                return await pending;
            } catch (error) {
                if (timing) finishDbCall(timing);
                throw error;
            } finally {
                pendingTransactions.delete(pending);
            }
        },

        async endTransaction(
            id: number,
            action: TransactionAction
        ): Promise<void> {
            if (action !== 'COMMIT' && action !== 'ROLLBACK') {
                throw new StoredProcedureBridgeError(
                    'DB_TRANSACTION_ACTION_INVALID',
                    {action}
                );
            }
            const client = transactions.get(id);
            if (!client) {
                throw new StoredProcedureBridgeError(
                    'DB_TRANSACTION_NOT_FOUND',
                    {txId: id}
                );
            }
            transactions.delete(id);
            try {
                await client.query(action);
                client.release();
            } catch (error) {
                client.release(error instanceof Error ? error : true);
                throw error;
            } finally {
                finishTransactionTiming(id);
            }
        },

        poolStats(): DatabasePoolStats {
            return readDatabasePoolStats(pool);
        },

        async stop(): Promise<void> {
            if (stopped) return;
            stopped = true;
            const open = [...transactions.entries()];
            transactions.clear();
            const rollbacks = await Promise.allSettled(
                open.map(async ([id, client]) => {
                    try {
                        await client.query('ROLLBACK');
                        client.release();
                    } catch (error) {
                        client.release(error instanceof Error ? error : true);
                        throw error;
                    } finally {
                        finishTransactionTiming(id);
                    }
                })
            );
            await Promise.allSettled([...pendingTransactions]);
            await pool.end();
            const failures = rollbacks
                .filter(
                    (result): result is PromiseRejectedResult =>
                        result.status === 'rejected'
                )
                .map((result) => result.reason);
            if (failures.length > 0) {
                throw new AggregateError(
                    failures,
                    'Failed to roll back active PostgreSQL transactions'
                );
            }
        }
    };
}
