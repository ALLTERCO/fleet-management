/**
 * Pre-flight resolver benchmark.
 *
 * Populates a temp Postgres schema with synthetic authz data
 * (100 users × 50 personas × 5000 devices × groups + assignments)
 * and measures the SQL the future resolver will run.
 *
 * Targets (per docs/plans/2026-04-30-authz-redesign.md §16):
 *   p95 single Check  : < 5ms  (warm cache)
 *   p95 cold resolve  : < 15ms
 *   ListAccessible    : < 100ms for 5k devices
 *
 * Usage:
 *   npx tsx backend/scripts/bench-authz-resolver.ts
 *   npx tsx backend/scripts/bench-authz-resolver.ts --users=100 --devices=5000 --runs=200
 *
 * Notes:
 *   - Uses a temporary schema 'bench_authz' that is dropped at end.
 *   - Does NOT touch production tables.
 *   - Numbers are SQL-only (no JS resolver overhead). Add ~0.5-1ms in real path.
 */

import {Client} from 'pg';

import {configRc} from '../src/config';

const args = process.argv.slice(2);
function arg(name: string, def: number): number {
    const m = args.find((a) => a.startsWith(`--${name}=`));
    return m ? Number.parseInt(m.split('=')[1], 10) : def;
}

const N_USERS = arg('users', 100);
const N_PERSONAS = arg('personas', 50);
const N_DEVICES = arg('devices', 5000);
const N_LOCATIONS = arg('locations', 30);
const N_DEVICE_GROUPS = arg('device-groups', 20);
const N_USER_GROUPS = arg('user-groups', 15);
const N_RUNS = arg('runs', 200);
const SCHEMA = 'bench_authz';

function percentile(sorted: number[], p: number): number {
    const i = Math.min(
        sorted.length - 1,
        Math.floor((p / 100) * sorted.length)
    );
    return sorted[i];
}

function format(stats: number[]): string {
    const sorted = [...stats].sort((a, b) => a - b);
    return (
        `p50=${percentile(sorted, 50).toFixed(2)}ms  ` +
        `p95=${percentile(sorted, 95).toFixed(2)}ms  ` +
        `p99=${percentile(sorted, 99).toFixed(2)}ms  ` +
        `max=${sorted[sorted.length - 1].toFixed(2)}ms`
    );
}

async function setupSchema(c: Client) {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.query(`CREATE SCHEMA ${SCHEMA}`);
    await c.query(`SET search_path TO ${SCHEMA}`);

    await c.query(`
        CREATE TABLE personas (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    uuid,
            key          text NOT NULL,
            name         text NOT NULL,
            statements   jsonb NOT NULL,
            version      int NOT NULL DEFAULT 1
        );
        CREATE TABLE groups (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   uuid NOT NULL,
            name        text NOT NULL
        );
        CREATE TABLE group_memberships (
            group_id    uuid NOT NULL,
            user_id     uuid NOT NULL,
            PRIMARY KEY (group_id, user_id)
        );
        CREATE INDEX gm_user_idx ON group_memberships (user_id);
        CREATE TABLE assignments (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     uuid NOT NULL,
            subject_type  text NOT NULL,
            subject_id    uuid NOT NULL,
            persona_id    uuid NOT NULL REFERENCES personas(id),
            scope         jsonb NOT NULL
        );
        CREATE INDEX a_subject_idx ON assignments (tenant_id, subject_type, subject_id);
        CREATE TABLE devices_meta (
            device_id          int PRIMARY KEY,
            location_id        int NOT NULL,
            device_group_ids   int[] NOT NULL,
            tags               text[] NOT NULL
        );
        CREATE INDEX d_loc_idx ON devices_meta (location_id);
        CREATE INDEX d_group_idx ON devices_meta USING GIN (device_group_ids);
        CREATE INDEX d_tags_idx ON devices_meta USING GIN (tags);
    `);
}

async function populate(c: Client) {
    const tenantId = '00000000-0000-0000-0000-000000000001';

    const userIds: string[] = [];
    for (let i = 0; i < N_USERS; i++) {
        userIds.push(
            `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, '0')}`
        );
    }

    const personaIds: string[] = [];
    for (let i = 0; i < N_PERSONAS; i++) {
        const r = await c.query(
            `INSERT INTO personas (tenant_id, key, name, statements)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [
                tenantId,
                `persona_${i}`,
                `Persona ${i}`,
                JSON.stringify([
                    {
                        actions: ['device:read', 'device:write'],
                        resource_types: ['device']
                    }
                ])
            ]
        );
        personaIds.push(r.rows[0].id);
    }

    const groupIds: string[] = [];
    for (let i = 0; i < N_USER_GROUPS; i++) {
        const r = await c.query(
            `INSERT INTO groups (tenant_id, name) VALUES ($1, $2) RETURNING id`,
            [tenantId, `group_${i}`]
        );
        groupIds.push(r.rows[0].id);
    }

    for (let i = 0; i < N_USERS; i++) {
        const uid = userIds[i];
        const memberOf = groupIds.filter(() => Math.random() < 0.2);
        for (const gid of memberOf) {
            await c.query(
                `INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)`,
                [gid, uid]
            );
        }
    }

    for (const gid of groupIds) {
        const nAssign = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < nAssign; k++) {
            const pid =
                personaIds[Math.floor(Math.random() * personaIds.length)];
            const scope =
                Math.random() < 0.3
                    ? {all: true}
                    : {
                          location_ids: [
                              Math.floor(Math.random() * N_LOCATIONS)
                          ]
                      };
            await c.query(
                `INSERT INTO assignments (tenant_id, subject_type, subject_id, persona_id, scope)
                 VALUES ($1, 'group', $2, $3, $4)`,
                [tenantId, gid, pid, JSON.stringify(scope)]
            );
        }
    }

    for (const uid of userIds) {
        if (Math.random() < 0.5) {
            const pid =
                personaIds[Math.floor(Math.random() * personaIds.length)];
            await c.query(
                `INSERT INTO assignments (tenant_id, subject_type, subject_id, persona_id, scope)
                 VALUES ($1, 'user', $2, $3, $4)`,
                [
                    tenantId,
                    uid,
                    pid,
                    JSON.stringify({
                        device_ids: [
                            Math.floor(Math.random() * N_DEVICES),
                            Math.floor(Math.random() * N_DEVICES)
                        ]
                    })
                ]
            );
        }
    }

    const tagPool = [
        'production',
        'staging',
        'hvac',
        'lights',
        'locks',
        'eu',
        'us'
    ];
    for (let d = 0; d < N_DEVICES; d++) {
        const dgs: number[] = [];
        for (let g = 0; g < N_DEVICE_GROUPS; g++)
            if (Math.random() < 0.1) dgs.push(g);
        const tags = tagPool.filter(() => Math.random() < 0.2);
        await c.query(
            `INSERT INTO devices_meta (device_id, location_id, device_group_ids, tags)
             VALUES ($1, $2, $3, $4)`,
            [d, Math.floor(Math.random() * N_LOCATIONS), dgs, tags]
        );
    }

    return {tenantId, userIds, personaIds};
}

async function timeIt<T>(fn: () => Promise<T>): Promise<number> {
    const t0 = process.hrtime.bigint();
    await fn();
    return Number(process.hrtime.bigint() - t0) / 1_000_000;
}

async function benchResolve(
    c: Client,
    tenantId: string,
    userIds: string[]
): Promise<number[]> {
    const samples: number[] = [];
    for (let i = 0; i < N_RUNS; i++) {
        const uid = userIds[Math.floor(Math.random() * userIds.length)];
        const ms = await timeIt(async () => {
            await c.query(
                `WITH user_groups AS (
                     SELECT group_id FROM group_memberships WHERE user_id = $2
                 )
                 SELECT a.id, a.subject_type, a.scope, p.statements
                 FROM assignments a
                 JOIN personas p ON p.id = a.persona_id
                 WHERE a.tenant_id = $1
                   AND ((a.subject_type = 'user' AND a.subject_id = $2)
                        OR (a.subject_type = 'group'
                            AND a.subject_id IN (SELECT group_id FROM user_groups)))`,
                [tenantId, uid]
            );
        });
        samples.push(ms);
    }
    return samples;
}

async function benchListAccessible(
    c: Client,
    tenantId: string,
    userIds: string[]
): Promise<number[]> {
    const samples: number[] = [];
    for (let i = 0; i < Math.min(N_RUNS, 50); i++) {
        const uid = userIds[Math.floor(Math.random() * userIds.length)];
        const ms = await timeIt(async () => {
            await c.query(
                `WITH user_groups AS (
                     SELECT group_id FROM group_memberships WHERE user_id = $2
                 ),
                 user_assignments AS (
                     SELECT scope FROM assignments
                     WHERE tenant_id = $1
                       AND ((subject_type = 'user' AND subject_id = $2)
                         OR (subject_type = 'group'
                             AND subject_id IN (SELECT group_id FROM user_groups)))
                 )
                 SELECT DISTINCT d.device_id
                 FROM devices_meta d, user_assignments a
                 WHERE (a.scope->>'all')::bool IS TRUE
                    OR (a.scope ? 'device_ids' AND d.device_id = ANY (
                        SELECT (jsonb_array_elements_text(a.scope->'device_ids'))::int))
                    OR (a.scope ? 'location_ids' AND d.location_id = ANY (
                        SELECT (jsonb_array_elements_text(a.scope->'location_ids'))::int))`,
                [tenantId, uid]
            );
        });
        samples.push(ms);
    }
    return samples;
}

async function main() {
    const config = (configRc as any).internalStorage?.connection;
    if (!config) {
        console.error(
            'ERROR: no internalStorage.connection in .fleet-managerrc'
        );
        process.exit(2);
    }

    const c = new Client(config);
    await c.connect();

    console.log('='.repeat(60));
    console.log('Authz Resolver Benchmark');
    console.log('='.repeat(60));
    console.log();
    console.log(
        `Users=${N_USERS}  Personas=${N_PERSONAS}  Devices=${N_DEVICES}  ` +
            `UserGroups=${N_USER_GROUPS}  DeviceGroups=${N_DEVICE_GROUPS}  ` +
            `Locations=${N_LOCATIONS}  Runs=${N_RUNS}`
    );
    console.log();

    try {
        process.stdout.write('Creating schema...        ');
        await setupSchema(c);
        console.log('done');

        process.stdout.write('Populating synthetic...   ');
        const t0 = Date.now();
        const {tenantId, userIds} = await populate(c);
        console.log(`done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        console.log();

        await c.query('ANALYZE');

        process.stdout.write('Bench: cold resolve       ');
        const cold = await benchResolve(c, tenantId, userIds);
        console.log(format(cold));

        process.stdout.write('Bench: warm resolve       ');
        const warm = await benchResolve(c, tenantId, userIds);
        console.log(format(warm));

        process.stdout.write('Bench: ListAccessible     ');
        const list = await benchListAccessible(c, tenantId, userIds);
        console.log(format(list));

        console.log();
        const warmP95 = percentile(
            [...warm].sort((a, b) => a - b),
            95
        );
        const listP95 = percentile(
            [...list].sort((a, b) => a - b),
            95
        );
        console.log('Verdict:');
        console.log(
            `  resolve p95 ${warmP95.toFixed(2)}ms  → target <15ms cold, <5ms warm  ` +
                `${warmP95 < 15 ? '✓' : '✗'}`
        );
        console.log(
            `  list    p95 ${listP95.toFixed(2)}ms  → target <100ms                 ` +
                `${listP95 < 100 ? '✓' : '✗'}`
        );
        console.log();
        console.log('Add ~0.5-1ms for JS resolver overhead in production.');
    } finally {
        await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await c.end();
    }
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
