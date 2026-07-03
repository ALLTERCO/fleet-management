// CI gate: architectural invariants enforced via grep. Each rule names
// a pattern, an allowlist of file paths that may legitimately match,
// and the reason it exists. Add new rules here as patterns stabilise.

import * as fs from 'node:fs';
import * as path from 'node:path';

interface Rule {
    name: string;
    pattern: RegExp;
    allowlist: Set<string>;
    why: string;
}

interface Violation {
    rule: string;
    file: string;
    line: number;
    text: string;
    why: string;
}

const ROOTS = ['src'];

const RULES: Rule[] = [
    {
        name: 'fm-redis-env-read',
        pattern: /process\.env\.FM_REDIS_(URL|DISABLED|KEY_PREFIX)/,
        allowlist: new Set(['src/config/tuning.ts']),
        why: 'FM_REDIS_* env reads must go through tuning.ts. Consumers read tuning.redisUrl / tuning.redisDisabled / tuning.redisKeyPrefix.'
    },
    {
        name: 'redis-client-access',
        // Verified callers via grep at 2026-05-14. New entries must be
        // added by hand with a one-line justification — keep tight.
        pattern: /\bgetSharedRedis\s*\(|\bgetSharedPubSub\s*\(/,
        allowlist: new Set([
            // Ports + the shared registry — the abstraction layer itself.
            'src/modules/redis/ports.redis.ts',
            'src/modules/redis/ports.shared.ts',
            'src/modules/redis/streamClients.ts',
            'src/modules/redis/RedisClients.ts',
            'src/modules/redis/RedisPubSub.ts',
            'src/modules/redis/health.ts',
            // health/streams endpoint inspects the live client.
            'src/modules/web/index.ts',
            // Stream-backed sinks predate the hex refactor.
            'src/modules/web/ws/sessionStreamRegistry.ts',
            'src/modules/status/StatusOverflowStream.ts',
            'src/modules/audit/AuditOverflowStream.ts',
            // em-sync buffer — same RedisStream sink shape as the two above.
            'src/modules/device/emSyncStream.ts',
            // Authz cache adapter chose direct client over a port.
            'src/modules/authz/runtime.ts',
            // Boot-time XLEN watchdog wiring — one getter call, not hot path.
            'src/app.ts'
        ]),
        why: 'Raw Redis client access should go through a port/service in modules/redis/. New consumers: add a port + null/redis adapter, then update the allowlist if a legitimate exception exists.'
    },
    {
        name: 'runtime-redis-toggle',
        pattern: /\b(isRedisDisabled|setRedisDisabled)\s*\(/,
        allowlist: new Set(),
        why: 'Runtime FM_REDIS_DISABLED mutability was removed in the hexagonal refactor (commit dfd7df96). The toggle is boot-time only — restart with a different env to switch.'
    },
    {
        // process.env reads outside tuning.ts mean two callers can drift
        // on the same env var's parsing/default. tuning.ts is the single
        // source of truth. Secrets handlers are exempt — they touch
        // pre-encryption material that has no business living in a
        // strongly-typed tuning singleton.
        name: 'process-env-direct-read',
        pattern: /process\.env\.[A-Z][A-Z0-9_]+/,
        allowlist: new Set([
            // Boot config + env loader own the raw reads.
            'src/config/tuning.ts',
            'src/config/envReader.ts',
            'src/config/index.ts',
            // Secrets read pre-encryption material directly.
            'src/config/secrets.ts',
            'src/modules/secretCrypto.ts',
            // JWT signing material (env-priority for JWT_SECRET; FM_JWT_KID_*
            // / FM_JWT_SECRET_PREVIOUS for the rotation slot). Hot-readable
            // so ops can flip kid mid-process during a rotation window.
            'src/modules/user/index.ts',
            'src/modules/user/signers.ts',
            // node:cluster / node-process intrinsics callers.
            'src/app.ts',
            'src/modules/Observability.ts',
            // Plugin host forwards arbitrary env to user plugins.
            'src/modules/plugins/Workers.ts',
            // Test-mode gating reads its own boolean directly.
            'src/modules/web/ws/sessionStreamRegistry.ts',
            // queryHandler is imported by test files that DI a fake
            // EnergyRepository — pulling tuning here would force
            // FM_API_CONTRACT_VERSION on every test.
            'src/model/energy/queryHandler.ts'
        ]),
        why: 'env vars must be read via tuning.ts so default values + boolean parsing live in one place. New consumers: add a field to TuningConfig + envReader call, then import {tuning}.'
    },
    {
        // Anyone calling pg directly bypasses connection pooling, query
        // logging, retry/timeout, and the test-mode mocks in
        // PostgresProvider.
        name: 'pg-direct-query',
        pattern: /\bnew Pool\s*\(|\bpg\.Client\s*\(|\bpg\.connect\s*\(/,
        allowlist: new Set(['src/modules/PostgresProvider.ts']),
        why: 'Raw pg driver access should go through PostgresProvider so connection pooling, query timing, error mapping, and retries stay consistent.'
    }
];

function walk(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
            walk(p, out);
        } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) {
            out.push(p);
        }
    }
}

function audit(
    file: string,
    relPath: string,
    rules: Rule[],
    out: Violation[]
): void {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const rule of rules) {
        if (rule.allowlist.has(relPath)) continue;
        for (let i = 0; i < lines.length; i++) {
            const code = lines[i].replace(/\/\/.*$/, '');
            if (rule.pattern.test(code)) {
                out.push({
                    rule: rule.name,
                    file: relPath,
                    line: i + 1,
                    text: lines[i].trim(),
                    why: rule.why
                });
            }
        }
    }
}

function main(): void {
    const cwd = process.cwd();
    const files: string[] = [];
    for (const r of ROOTS) walk(path.join(cwd, r), files);
    const violations: Violation[] = [];
    for (const f of files) {
        const rel = path.relative(cwd, f);
        audit(f, rel, RULES, violations);
    }
    if (violations.length === 0) {
        console.log(
            `[PASS] ${RULES.length} architectural invariants — no violations (${files.length} files scanned).`
        );
        return;
    }
    const byRule = new Map<string, Violation[]>();
    for (const v of violations) {
        const list = byRule.get(v.rule) ?? [];
        list.push(v);
        byRule.set(v.rule, list);
    }
    console.log(
        `[FAIL] ${violations.length} architectural-invariant violation(s):`
    );
    for (const [ruleName, vs] of byRule) {
        const rule = RULES.find((r) => r.name === ruleName);
        console.log(`\n  Rule: ${ruleName}`);
        console.log(`  Why:  ${rule?.why ?? ''}`);
        for (const v of vs) {
            console.log(`    ${v.file}:${v.line}: ${v.text}`);
        }
    }
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
