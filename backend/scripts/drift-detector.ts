// Schema drift detector. Run against a live client DB (set DATABASE_URL)
// and compare its function signatures / table columns / indexes against
// the expected state the migration files produce.
//
// The "expected" state is derived by applying every migration UP in order
// against an ephemeral Postgres. Expensive but accurate — no committed
// snapshot to maintain, drift shows up the moment migrations change.
//
// Usage:
//   DATABASE_URL=postgres://user:pw@host/db npx tsx backend/scripts/drift-detector.ts
//   Optional EPHEMERAL_DB_URL for the expected-state DB (default: same
//   host, ephemeral db name). Honours TIMESCALE_DIALECT=1 to skip
//   timescale-only migrations if the target is vanilla PG.
//
// Exit: 0 clean, 1 any drift finding.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {Client} from 'pg';

const MIGRATION_ROOT = path.resolve(
    __dirname,
    '..',
    'db',
    'migration',
    'postgresql'
);

const LIVE_URL = process.env.DATABASE_URL;
const EXPECTED_URL = process.env.EXPECTED_DATABASE_URL;

if (!LIVE_URL || !EXPECTED_URL) {
    console.error(
        'DATABASE_URL and EXPECTED_DATABASE_URL both required.\n' +
            '  DATABASE_URL = the client DB to audit\n' +
            '  EXPECTED_DATABASE_URL = an ephemeral PG the script applies migrations to'
    );
    process.exit(2);
}

if (LIVE_URL === EXPECTED_URL) {
    console.error(
        'DATABASE_URL === EXPECTED_DATABASE_URL. Point EXPECTED at a throwaway DB.'
    );
    process.exit(2);
}

const naturalCompare = (a: string, b: string) =>
    a.localeCompare(b, undefined, {numeric: true});

interface Finding {
    category: 'function' | 'table' | 'column' | 'index';
    subject: string;
    kind: 'missing-on-live' | 'extra-on-live' | 'drift';
    detail: string;
}

interface Snapshot {
    functions: Map<string, string>; // qname(args) -> return
    tables: Set<string>; // schema.table
    columns: Map<string, string>; // schema.table.col -> type
    indexes: Set<string>; // schema.table.indexname
}

const TRACKED_SCHEMAS = [
    'device',
    'logging',
    'notifications',
    'organization',
    'ui',
    'user'
];

async function introspect(url: string): Promise<Snapshot> {
    const client = new Client({connectionString: url});
    await client.connect();
    try {
        const schemaList = TRACKED_SCHEMAS.map((s) => `'${s}'`).join(',');

        const fns = await client.query<{
            qname: string;
            args: string;
            ret: string;
        }>(
            `SELECT n.nspname || '.' || p.proname AS qname,
                    pg_get_function_identity_arguments(p.oid) AS args,
                    pg_get_function_result(p.oid) AS ret
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN (${schemaList})`
        );
        const functions = new Map<string, string>();
        for (const r of fns.rows) {
            functions.set(`${r.qname}(${r.args})`, r.ret);
        }

        const tbls = await client.query<{qname: string}>(
            `SELECT table_schema || '.' || table_name AS qname
             FROM information_schema.tables
             WHERE table_schema IN (${schemaList}) AND table_type = 'BASE TABLE'`
        );
        const tables = new Set(tbls.rows.map((r) => r.qname));

        const cols = await client.query<{qname: string; typ: string}>(
            `SELECT table_schema || '.' || table_name || '.' || column_name AS qname,
                    data_type || COALESCE('(' || character_maximum_length::text || ')', '') AS typ
             FROM information_schema.columns
             WHERE table_schema IN (${schemaList})`
        );
        const columns = new Map<string, string>();
        for (const r of cols.rows) {
            columns.set(r.qname, r.typ);
        }

        const idx = await client.query<{qname: string}>(
            `SELECT schemaname || '.' || tablename || '.' || indexname AS qname
             FROM pg_indexes
             WHERE schemaname IN (${schemaList})`
        );
        const indexes = new Set(idx.rows.map((r) => r.qname));

        return {functions, tables, columns, indexes};
    } finally {
        await client.end();
    }
}

async function applyMigrations(url: string): Promise<void> {
    const client = new Client({connectionString: url});
    await client.connect();
    try {
        // Fail early with a clear message if TimescaleDB isn't available —
        // otherwise the first `create_hypertable(...)` migration errors
        // deep in the chain with an opaque "function does not exist".
        try {
            await client.query(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);
        } catch (err: any) {
            throw new Error(
                `TimescaleDB extension unavailable on the expected DB: ${err.message}. ` +
                    `Use a TimescaleDB-enabled Postgres image (e.g. timescale/timescaledb:latest-pg17) ` +
                    `as the EXPECTED_DATABASE_URL target.`
            );
        }
        const schemaDirs = fs
            .readdirSync(MIGRATION_ROOT, {withFileTypes: true})
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort(naturalCompare);
        for (const schema of schemaDirs) {
            const dirPath = path.join(MIGRATION_ROOT, schema);
            const files = fs
                .readdirSync(dirPath)
                .filter((f) => f.endsWith('.sql'))
                .sort(naturalCompare);
            for (const f of files) {
                const content = fs.readFileSync(path.join(dirPath, f), 'utf8');
                const up = content
                    .split(/^-{2,}\s*DOWN\s*$/im)[0]
                    .replace(/^-{2,}\s*UP\s*$/im, '');
                if (!up.trim()) continue;
                try {
                    await client.query(up);
                } catch (err: any) {
                    throw new Error(
                        `Expected-DB migration ${schema}/${f} failed: ${err.message}`
                    );
                }
            }
        }
    } finally {
        await client.end();
    }
}

function diff(expected: Snapshot, live: Snapshot): Finding[] {
    const out: Finding[] = [];

    for (const [sig, ret] of expected.functions) {
        const liveRet = live.functions.get(sig);
        if (liveRet === undefined) {
            out.push({
                category: 'function',
                subject: sig,
                kind: 'missing-on-live',
                detail: `expected return: ${ret}`
            });
        } else if (liveRet !== ret) {
            out.push({
                category: 'function',
                subject: sig,
                kind: 'drift',
                detail: `expected: ${ret}, live: ${liveRet}`
            });
        }
    }
    for (const sig of live.functions.keys()) {
        if (!expected.functions.has(sig)) {
            out.push({
                category: 'function',
                subject: sig,
                kind: 'extra-on-live',
                detail: ''
            });
        }
    }

    for (const t of expected.tables) {
        if (!live.tables.has(t)) {
            out.push({
                category: 'table',
                subject: t,
                kind: 'missing-on-live',
                detail: ''
            });
        }
    }
    for (const t of live.tables) {
        if (!expected.tables.has(t)) {
            out.push({
                category: 'table',
                subject: t,
                kind: 'extra-on-live',
                detail: ''
            });
        }
    }

    for (const [c, typ] of expected.columns) {
        const liveTyp = live.columns.get(c);
        if (liveTyp === undefined) {
            out.push({
                category: 'column',
                subject: c,
                kind: 'missing-on-live',
                detail: `expected: ${typ}`
            });
        } else if (liveTyp !== typ) {
            out.push({
                category: 'column',
                subject: c,
                kind: 'drift',
                detail: `expected: ${typ}, live: ${liveTyp}`
            });
        }
    }
    for (const c of live.columns.keys()) {
        if (!expected.columns.has(c)) {
            out.push({
                category: 'column',
                subject: c,
                kind: 'extra-on-live',
                detail: ''
            });
        }
    }

    for (const i of expected.indexes) {
        if (!live.indexes.has(i)) {
            out.push({
                category: 'index',
                subject: i,
                kind: 'missing-on-live',
                detail: ''
            });
        }
    }
    for (const i of live.indexes) {
        if (!expected.indexes.has(i)) {
            out.push({
                category: 'index',
                subject: i,
                kind: 'extra-on-live',
                detail: ''
            });
        }
    }

    return out;
}

async function main() {
    console.log(`Live DB:     ${LIVE_URL!.replace(/:[^:@]+@/, ':***@')}`);
    console.log(`Expected DB: ${EXPECTED_URL!.replace(/:[^:@]+@/, ':***@')}`);
    console.log('\nApplying migrations to expected DB...');
    await applyMigrations(EXPECTED_URL!);
    console.log('Introspecting...');
    const [expected, live] = await Promise.all([
        introspect(EXPECTED_URL!),
        introspect(LIVE_URL!)
    ]);

    const findings = diff(expected, live);
    if (findings.length === 0) {
        console.log('\nNo drift.');
        process.exit(0);
    }
    const byCategory = new Map<string, Finding[]>();
    for (const f of findings) {
        if (!byCategory.has(f.category)) byCategory.set(f.category, []);
        byCategory.get(f.category)!.push(f);
    }
    for (const [cat, list] of byCategory) {
        console.log(`\n=== ${cat} (${list.length}) ===`);
        for (const f of list) {
            console.log(
                `  [${f.kind}] ${f.subject}${f.detail ? ` — ${f.detail}` : ''}`
            );
        }
    }
    console.log(`\n${findings.length} drift findings.`);
    process.exit(1);
}

main().catch((err) => {
    console.error(`\n${err.message || err}`);
    process.exit(2);
});
