// CI gate: proves an already-deployed DB upgrades to the same schema a fresh
// install gets. Builds two databases on the target server — one fresh (current
// migrations) and one upgraded (baseline migrations, then current on top) — and
// asserts their schemas are identical. This is what catches editing or deleting
// a SHIPPED migration in place: the fresh build sees the change, the upgraded DB
// skips it by name, and the fingerprints diverge.
//
//   FM_PG_TEST_URL            target server (same container as the apply gate)
//   FM_MIGRATION_BASELINE_REF git ref of the deployed migrations (default origin/devops)
//
// The migration runner memoizes one DB client per process, so each apply runs
// in its own child process (this same file, in FM_MIG_APPLY_ROOT worker mode).
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {MIGRATION_DIRS} from '../src/config/migrationLayout';
import {
    applyMigrations,
    type PgConfig,
    pgConfigFromUrl,
    prepareDatabase,
    recreateDatabase,
    schemaFingerprint
} from './migrationTestDb';

const DB_URL =
    process.env.FM_PG_TEST_URL ?? 'postgres://postgres@localhost:5432/postgres';
const BASELINE_REF = process.env.FM_MIGRATION_BASELINE_REF ?? 'origin/devops';

const BACKEND_DIR = process.cwd();
const REPO_ROOT = join(BACKEND_DIR, '..');
const MIG_SUBTREE = 'backend/db/migration/postgresql';
const SELF = 'scripts/test-migrations-upgrade.ts';
const FRESH_DB = 'fm_mig_fresh';
const UPGRADE_DB = 'fm_mig_upgrade';

function dbUrl(name: string): string {
    const u = new URL(DB_URL);
    u.pathname = `/${name}`;
    return u.toString();
}

function dbConfig(name: string): PgConfig {
    return {...pgConfigFromUrl(DB_URL), database: name};
}

function migrationDirsUnder(backendRoot: string): string[] {
    return MIGRATION_DIRS.map((d) => join(backendRoot, d));
}

// Apply one tree to one database in a child process (one migration() per process).
function applyInChild(backendRoot: string, targetUrl: string): void {
    execFileSync('npx', ['tsx', SELF], {
        cwd: BACKEND_DIR,
        stdio: 'inherit',
        env: {
            ...process.env,
            FM_PG_TEST_URL: targetUrl,
            FM_MIG_APPLY_ROOT: backendRoot
        }
    });
}

// Resolve the baseline ref, fetching it if a shallow CI clone lacks it.
function ensureBaselineRef(): void {
    try {
        execFileSync(
            'git',
            ['rev-parse', '--verify', `${BASELINE_REF}^{commit}`],
            {cwd: REPO_ROOT, stdio: 'ignore'}
        );
    } catch {
        const branch = BASELINE_REF.replace(/^origin\//, '');
        execFileSync('git', ['fetch', '--depth=1', 'origin', branch], {
            cwd: REPO_ROOT,
            stdio: 'inherit'
        });
    }
}

// The baseline migrations exactly as committed on the deployed ref.
function materializeBaseline(workRoot: string): string {
    rmSync(workRoot, {recursive: true, force: true});
    mkdirSync(workRoot, {recursive: true});
    execFileSync(
        'bash',
        [
            '-c',
            `git archive ${BASELINE_REF} ${MIG_SUBTREE} | tar -x -C ${workRoot}`
        ],
        {cwd: REPO_ROOT, stdio: 'inherit'}
    );
    return join(workRoot, 'backend');
}

// The current migrations (working tree, incl. uncommitted) over the SAME path,
// so the ledger dedups by name and only genuinely-new migrations re-run.
function materializeCurrent(workRoot: string): string {
    const dest = join(workRoot, MIG_SUBTREE);
    rmSync(dest, {recursive: true, force: true});
    mkdirSync(dirname(dest), {recursive: true});
    cpSync(join(BACKEND_DIR, 'db/migration/postgresql'), dest, {
        recursive: true
    });
    return join(workRoot, 'backend');
}

function firstDiff(a: string, b: string): string {
    const al = a.split('\n');
    const bl = b.split('\n');
    for (let i = 0; i < Math.max(al.length, bl.length); i++) {
        if (al[i] !== bl[i]) {
            return `line ${i + 1}:\n  fresh:   ${al[i] ?? '<none>'}\n  upgrade: ${bl[i] ?? '<none>'}`;
        }
    }
    return '(no line diff — section lengths differ)';
}

async function buildFresh(): Promise<string> {
    await recreateDatabase(dbConfig('postgres'), FRESH_DB);
    await prepareDatabase(dbConfig(FRESH_DB));
    applyInChild(BACKEND_DIR, dbUrl(FRESH_DB));
    return schemaFingerprint(dbConfig(FRESH_DB));
}

async function buildUpgraded(workRoot: string): Promise<string> {
    await recreateDatabase(dbConfig('postgres'), UPGRADE_DB);
    await prepareDatabase(dbConfig(UPGRADE_DB));
    applyInChild(materializeBaseline(workRoot), dbUrl(UPGRADE_DB));
    applyInChild(materializeCurrent(workRoot), dbUrl(UPGRADE_DB));
    return schemaFingerprint(dbConfig(UPGRADE_DB));
}

async function main(): Promise<void> {
    const admin = pgConfigFromUrl(DB_URL);
    console.log(
        `[upgrade-gate] server ${admin.host}:${admin.port}, baseline ${BASELINE_REF}`
    );
    ensureBaselineRef();

    const fresh = await buildFresh();
    console.log('[upgrade-gate] fresh build applied');

    const workRoot = mkdtempSync(join(tmpdir(), 'fm-mig-upgrade-'));
    try {
        const upgraded = await buildUpgraded(workRoot);
        console.log('[upgrade-gate] baseline+current applied');

        if (fresh !== upgraded) {
            console.error(
                '[upgrade-gate] FAILED: upgraded schema differs from a fresh build.\n' +
                    'A shipped migration was likely edited or deleted in place — ' +
                    'add a NEW migration instead.\n' +
                    firstDiff(fresh, upgraded)
            );
            process.exit(1);
        }
        console.log('[upgrade-gate] PASS — upgrade and fresh schemas match');
    } finally {
        rmSync(workRoot, {recursive: true, force: true});
    }
}

async function worker(backendRoot: string): Promise<void> {
    await applyMigrations(
        pgConfigFromUrl(DB_URL),
        migrationDirsUnder(backendRoot)
    );
}

const applyRoot = process.env.FM_MIG_APPLY_ROOT;
const job = applyRoot ? worker(applyRoot) : main();
job.catch((err) => {
    console.error('[upgrade-gate] FAILED:', err.message ?? err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
