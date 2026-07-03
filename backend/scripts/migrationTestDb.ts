// Shared helpers for the migration CI gates (apply + upgrade). One home for
// connecting, resetting, applying, and fingerprinting the schema so both gates
// agree on what "the schema" is.
import migration from 'migration-collection/lib/postgres';
import {Client} from 'pg';
import {LINKED_SCHEMAS, MIGRATION_DIRS} from '../src/config/migrationLayout';

export interface PgConfig {
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
    connectionTimeoutMillis?: number;
}

export function pgConfigFromUrl(rawUrl: string): PgConfig {
    const url = new URL(rawUrl);
    return {
        host: url.hostname,
        port: Number(url.port || 5432),
        user: url.username || 'postgres',
        password: url.password || undefined,
        database: url.pathname.slice(1) || 'postgres',
        connectionTimeoutMillis: 10_000
    };
}

// Wipe every app schema plus the ledger, restoring the bare prerequisites the
// migration runner assumes (the migration schema + timescaledb extension).
export async function resetSchemas(config: PgConfig): Promise<void> {
    const client = new Client(config);
    await client.connect();
    try {
        for (const s of [...LINKED_SCHEMAS, 'migration', 'public']) {
            await client.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
        }
        await client.query('CREATE SCHEMA public');
        await client.query('CREATE SCHEMA IF NOT EXISTS migration');
        await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
    } finally {
        await client.end();
    }
}

// Bare prerequisites the migration runner assumes, for a freshly-created (empty)
// database: the migration ledger schema and the timescaledb extension.
export async function prepareDatabase(config: PgConfig): Promise<void> {
    const client = new Client(config);
    await client.connect();
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
        await client.query('CREATE SCHEMA IF NOT EXISTS migration');
    } finally {
        await client.end();
    }
}

// Drop and recreate a database from the admin connection (which must target a
// different database). Gives each gate run a pristine, isolated schema.
export async function recreateDatabase(
    adminConfig: PgConfig,
    name: string
): Promise<void> {
    const client = new Client(adminConfig);
    await client.connect();
    try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await client.query(`CREATE DATABASE "${name}"`);
    } finally {
        await client.end();
    }
}

// Apply a migration tree. `dirs` defaults to the repo's committed layout; the
// upgrade gate passes materialized baseline/current trees instead.
export async function applyMigrations(
    config: PgConfig,
    dirs: readonly string[] = MIGRATION_DIRS
): Promise<void> {
    await migration({
        connection: {...config, max: 4, idleTimeoutMillis: 5_000},
        schema: 'migration',
        cwd: dirs,
        link: {schemas: LINKED_SCHEMAS}
    });
}

// A deterministic text snapshot of the app schemas: columns, function
// definitions, indexes and constraints. Two DBs with the same fingerprint have
// the same schema. Excludes the migration ledger (its names are path-derived).
export async function schemaFingerprint(config: PgConfig): Promise<string> {
    const client = new Client(config);
    await client.connect();
    try {
        const schemas = LINKED_SCHEMAS as unknown as string[];
        const sections: string[] = [];
        for (const [title, sql] of FINGERPRINT_QUERIES) {
            const {rows} = await client.query<{line: string}>(sql, [schemas]);
            sections.push(`# ${title}\n${rows.map((r) => r.line).join('\n')}`);
        }
        return sections.join('\n\n');
    } finally {
        await client.end();
    }
}

const FINGERPRINT_QUERIES: ReadonlyArray<readonly [string, string]> = [
    [
        'columns',
        `SELECT table_schema||'.'||table_name||'.'||column_name||' '||data_type
                ||' null='||is_nullable||' def='||coalesce(column_default,'') AS line
         FROM information_schema.columns
         WHERE table_schema = ANY($1) ORDER BY 1`
    ],
    [
        'functions',
        `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)
                ||') '||pg_get_functiondef(p.oid) AS line
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = ANY($1) ORDER BY 1`
    ],
    [
        'indexes',
        `SELECT schemaname||'.'||indexname||' '||indexdef AS line
         FROM pg_indexes WHERE schemaname = ANY($1) ORDER BY 1`
    ],
    [
        'constraints',
        `SELECT n.nspname||'.'||rel.relname||'.'||c.conname||' '||pg_get_constraintdef(c.oid) AS line
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         JOIN pg_class rel ON rel.oid = c.conrelid
         WHERE n.nspname = ANY($1) ORDER BY 1`
    ]
];
