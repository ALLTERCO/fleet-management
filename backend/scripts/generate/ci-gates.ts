// Phase 0a CI gates — baseline drift, system-growth cap, component-registration
// match, and (placeholder) response-schema snapshot. Run from .gitlab-ci.yml.

import {execSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {GENERATED_DIR, REPO_ROOT} from './_shared.js';
import {generate as genAiIndex} from './ai-index.js';
import {generate as genApiOpenapi} from './api-openapi.js';
import {generate as genEvents} from './backend-event-inventory.js';
import {generate as genHttp} from './backend-http-inventory.js';
import {generate as genRpc} from './backend-rpc-inventory.js';
import {generate as genWs} from './backend-ws-inventory.js';
import {generate as genFrontend} from './frontend-backend-dependencies.js';
import {generate as genHostContract} from './host-contract.js';
import {generate as genHostSdk} from './host-sdk-index.js';
import {generate as genNodeRed} from './node-red-catalog.js';
import {generate as genTopology} from './topology-metadata.js';
import {generate as genAuth} from './transport-auth-matrix.js';

interface GateResult {
    gate: string;
    passed: boolean;
    message: string;
}

// Navigation-only keys — stripped only on inventory-row records, never
// recursively. A nested schema containing a field named `sourceFile` must
// not be silently elided from the gate.
const NON_CONTRACT_KEYS = new Set(['sourceLine', 'sourceFile']);
const INVENTORY_ROW_KEYS = new Set([
    'components',
    'methods',
    'routes',
    'mounts',
    'paths',
    'handlers',
    'events',
    'calls',
    'rows',
    'subscriptions'
]);

function stripRow(row: unknown): unknown {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
        if (NON_CONTRACT_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out;
}

function stripNonContract(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (INVENTORY_ROW_KEYS.has(k) && Array.isArray(v)) {
            out[k] = v.map(stripRow);
        } else {
            out[k] = v;
        }
    }
    return out;
}

function stripAiIndexVolatile(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
    const index = value as {resources?: unknown};
    if (!Array.isArray(index.resources)) return value;
    return {
        ...value,
        resources: index.resources.map((resource) => {
            if (
                !resource ||
                typeof resource !== 'object' ||
                Array.isArray(resource)
            ) {
                return resource;
            }
            // sizeKb and exists reflect the local filesystem (e.g. CLAUDE.md
            // is gitignored — present for devs, absent in CI), so they are
            // volatile, not contract. Strip both before drift comparison.
            const {
                sizeKb: _sizeKb,
                exists: _exists,
                ...stableResource
            } = resource as Record<string, unknown>;
            return stableResource;
        })
    };
}

function contractComparable(file: string, value: unknown): unknown {
    const stripped = stripNonContract(value);
    if (file === 'ai-index.json') return stripAiIndexVolatile(stripped);
    return stripped;
}

// 32 MB cap — api.openapi.json alone is ~2.7 MB and growing.
const GIT_SHOW_MAX_BUFFER = 32 * 1024 * 1024;

function readCommittedJson(relPath: string): unknown {
    const raw = execSync(`git show HEAD:${relPath}`, {
        cwd: REPO_ROOT,
        maxBuffer: GIT_SHOW_MAX_BUFFER
    }).toString();
    return JSON.parse(raw);
}

async function buildLiveContractJsons(): Promise<Record<string, unknown>> {
    const openapi = await genApiOpenapi({write: false});
    const rpc = genRpc();
    const auth = genAuth();
    return {
        'backend-rpc-inventory.json': rpc,
        'backend-http-inventory.json': genHttp(),
        'backend-ws-inventory.json': genWs(),
        'backend-event-inventory.json': genEvents(),
        'frontend-backend-dependencies.json': genFrontend(),
        'transport-auth-matrix.json': auth,
        'api.openapi.json': openapi.document,
        'ai-index.json': genAiIndex(),
        'host-sdk-index.json': genHostSdk(),
        'node-red-catalog.json': await genNodeRed({rpc, auth}),
        'topology-metadata.json': genTopology()
    };
}

// --- Gate 1: Baseline drift ---------------------------------------------

async function gateBaselineDrift(): Promise<GateResult> {
    const generatedJsons = [
        'backend-rpc-inventory.json',
        'backend-http-inventory.json',
        'backend-ws-inventory.json',
        'backend-event-inventory.json',
        'frontend-backend-dependencies.json',
        'transport-auth-matrix.json',
        'api.openapi.json',
        'ai-index.json',
        'host-sdk-index.json',
        'node-red-catalog.json',
        'topology-metadata.json'
    ];
    const missing = generatedJsons.filter(
        (f) => !fs.existsSync(path.join(GENERATED_DIR, f))
    );
    if (missing.length > 0) {
        return {
            gate: 'baseline-drift',
            passed: false,
            message: `Missing baseline files: ${missing.join(', ')}. Run \`npm run generate\` and commit.`
        };
    }
    const liveJsons = await buildLiveContractJsons();
    const drift: string[] = [];
    for (const file of generatedJsons) {
        const rel = path.posix.join('docs', 'generated', file);
        try {
            const committed = contractComparable(file, readCommittedJson(rel));
            const live = contractComparable(file, liveJsons[file]);
            if (JSON.stringify(committed) !== JSON.stringify(live)) {
                drift.push(file);
            }
        } catch (err) {
            return {
                gate: 'baseline-drift',
                passed: false,
                message: `Failed to compare ${file}: ${String(err)}`
            };
        }
    }
    if (drift.length > 0) {
        return {
            gate: 'baseline-drift',
            passed: false,
            message: `Contract drift in:\n${drift.join('\n')}\nThis is a real change to the API surface. Regenerate with \`npm run generate\` from the repo root and review the diff before committing.`
        };
    }
    return {
        gate: 'baseline-drift',
        passed: true,
        message: 'Baseline JSONs match the repository (contract material only).'
    };
}

// --- Gate 1b: Host SDK contract freshness --------------------------------

// Regenerate the contract and fail if it differs from what is committed.
async function gateHostContract(): Promise<GateResult> {
    const rel = 'frontend/src/shell/template-host/generated/contract.ts';
    try {
        await genHostContract();
    } catch (err) {
        return {
            gate: 'host-contract',
            passed: false,
            message: `Failed to generate host contract: ${String(err)}`
        };
    }
    // porcelain catches both modified and untracked (an uncommitted contract).
    const status = execSync(`git status --porcelain -- ${rel}`, {
        cwd: REPO_ROOT
    })
        .toString()
        .trim();
    if (status) {
        return {
            gate: 'host-contract',
            passed: false,
            message: `Host SDK contract is stale or uncommitted (${rel}). Regenerate with \`cd backend && npm run generate\` and commit.`
        };
    }
    return {
        gate: 'host-contract',
        passed: true,
        message: 'Host SDK contract matches the live _DESCRIBE surface.'
    };
}

// --- Gate 2: System-growth -----------------------------------------------

function gateSystemGrowth(): GateResult {
    let inv: ReturnType<typeof genRpc>;
    try {
        inv = readCommittedJson(
            'docs/generated/backend-rpc-inventory.json'
        ) as ReturnType<typeof genRpc>;
    } catch {
        return {
            gate: 'system-growth',
            passed: false,
            message: 'No baseline inventory found.'
        };
    }
    const live = genRpc();
    const baseline = inv.methods.filter(
        (m) => m.namespace === 'system' && m.kind === 'explicit'
    ).length;
    const liveCount = live.methods.filter(
        (m) => m.namespace === 'system' && m.kind === 'explicit'
    ).length;
    if (liveCount > baseline) {
        return {
            gate: 'system-growth',
            passed: false,
            message: `SystemComponent grew: baseline=${baseline}, live=${liveCount}. New methods must go into domain components, not System. If this is intentional (e.g., a new WS-lifecycle hook), regenerate the baseline with \`cd backend && npm run generate\` and commit.`
        };
    }
    return {
        gate: 'system-growth',
        passed: true,
        message: `SystemComponent methods: ${liveCount} (baseline ${baseline}).`
    };
}

// --- Gate 3: Component registration --------------------------------------

function gateComponentRegistration(): GateResult {
    let inv: ReturnType<typeof genRpc>;
    try {
        inv = readCommittedJson(
            'docs/generated/backend-rpc-inventory.json'
        ) as ReturnType<typeof genRpc>;
    } catch {
        return {
            gate: 'component-registration',
            passed: false,
            message: 'No baseline inventory found.'
        };
    }
    const live = genRpc();
    const baselineNames = new Set(inv.components.map((c) => c.namespace));
    const liveNames = new Set(live.components.map((c) => c.namespace));
    const added = [...liveNames].filter((n) => !baselineNames.has(n));
    const removed = [...baselineNames].filter((n) => !liveNames.has(n));
    if (added.length || removed.length) {
        return {
            gate: 'component-registration',
            passed: false,
            message: `Component registration drift. Added: ${added.join(', ') || '(none)'}; removed: ${removed.join(', ') || '(none)'}. Regenerate the baseline with \`cd backend && npm run generate\` and commit.`
        };
    }
    return {
        gate: 'component-registration',
        passed: true,
        message: `Registered components: ${liveNames.size} (matches baseline).`
    };
}

// --- Gate 4: Response-schema snapshot (Pass 1.5 placeholder) -------------

function gateResponseSchemaSnapshot(): GateResult {
    // Activates when `backend/src/types/api/` ships in Phase 0b. Until then,
    // this gate is a no-op documented as "not yet active".
    const apiTypesDir = path.join(REPO_ROOT, 'backend/src/types/api');
    if (!fs.existsSync(apiTypesDir)) {
        return {
            gate: 'response-schema-snapshot',
            passed: true,
            message:
                'Not yet active (awaits backend/src/types/api/ from Phase 0b).'
        };
    }
    // Phase 0b hook: diff every committed describe-snapshot against the live one.
    return {
        gate: 'response-schema-snapshot',
        passed: true,
        message: 'TODO: wire describe-snapshot diffing once Phase 0b lands.'
    };
}

// --- Gate 5: Transport auth explicitness ---------------------------------

function gateTransportAuthExplicitness(): GateResult {
    type Matrix = {
        rows: Array<{surface: string; authBucket: string}>;
    };
    const matrix = genAuth() as Matrix;
    const implicitRows = matrix.rows.filter((row) =>
        ['legacy-fallback', 'http-unknown'].includes(row.authBucket)
    );
    if (implicitRows.length > 0) {
        return {
            gate: 'transport-auth-explicitness',
            passed: false,
            message: `Implicit auth rows remain:\n${implicitRows.map((row) => `${row.surface}: ${row.authBucket}`).join('\n')}`
        };
    }
    return {
        gate: 'transport-auth-explicitness',
        passed: true,
        message: 'No legacy-fallback or http-unknown transport rows.'
    };
}

// --- Gate 6: Import-block discipline -------------------------------------

function gateImportDiscipline(): GateResult {
    try {
        execSync('npx tsx scripts/lint-imports.ts', {
            cwd: path.join(REPO_ROOT, 'backend'),
            stdio: 'pipe'
        });
        return {
            gate: 'import-discipline',
            passed: true,
            message: 'All TS files keep static imports at the top.'
        };
    } catch (err: unknown) {
        const out = (err as {stdout?: Buffer}).stdout?.toString() ?? '';
        return {
            gate: 'import-discipline',
            passed: false,
            message: `Mid-file static imports detected. Hoist them to the top block (use \`await import()\` for lazy/cycle-break only).\n${out}`
        };
    }
}

// --- Gate 7: Socket close-listener ownership -----------------------------

function gateSocketClose(): GateResult {
    try {
        execSync('npx tsx scripts/lint-socket-close.ts', {
            cwd: path.join(REPO_ROOT, 'backend'),
            stdio: 'pipe'
        });
        return {
            gate: 'socket-close-ownership',
            passed: true,
            message: 'Direct socket close listeners stay in lifecycle owners.'
        };
    } catch (err: unknown) {
        const out = (err as {stdout?: Buffer}).stdout?.toString() ?? '';
        return {
            gate: 'socket-close-ownership',
            passed: false,
            message: `Direct socket close listeners detected outside lifecycle owners.\n${out}`
        };
    }
}

// --- Gate 8: Architectural invariants ------------------------------------

function gateArchitecturalInvariants(): GateResult {
    try {
        const out = execSync('npx tsx scripts/lint-architecture.ts', {
            cwd: path.join(REPO_ROOT, 'backend'),
            stdio: 'pipe'
        }).toString();
        const match = out.match(/\[PASS\] (.*)/);
        return {
            gate: 'architectural-invariants',
            passed: true,
            message: match?.[1] ?? 'All invariants pass.'
        };
    } catch (err: unknown) {
        const out = (err as {stdout?: Buffer}).stdout?.toString() ?? '';
        return {
            gate: 'architectural-invariants',
            passed: false,
            message: `Architectural invariant violations.\n${out}`
        };
    }
}

// --- Gate 9: Shared refresh transport boundaries ------------------------

function gateRefreshBoundaries(): GateResult {
    try {
        const out = execSync(
            'node --import tsx scripts/lint-refresh-boundaries.ts',
            {
                cwd: path.join(REPO_ROOT, 'backend'),
                stdio: 'pipe'
            }
        ).toString();
        const match = out.match(/\[PASS\] (.*)/);
        return {
            gate: 'refresh-boundaries',
            passed: true,
            message: match?.[1] ?? 'Refresh boundaries pass.'
        };
    } catch (err: unknown) {
        const out = (err as {stdout?: Buffer}).stdout?.toString() ?? '';
        return {
            gate: 'refresh-boundaries',
            passed: false,
            message: `Shared refresh transport calls detected outside stores.\n${out}`
        };
    }
}

// --- Gate 10: Topology metadata quality ---------------------------------

function gateTopologyMetadataQuality(): GateResult {
    const inventory = genTopology();
    const problems: string[] = [];
    const moduleIds = inventory.modules.map((module) => module.id);
    const uniqueModuleIds = new Set(moduleIds);
    if (uniqueModuleIds.size !== moduleIds.length) {
        problems.push('Duplicate topology module ids detected.');
    }

    const missingTopology = inventory.modules
        .filter((module) => !module.hasTopology)
        .map((module) => module.id);
    if (missingTopology.length > 0) {
        problems.push(
            `Modules missing topology metadata: ${missingTopology.join(', ')}`
        );
    }

    const missingZones = inventory.modules
        .filter((module) => !(module.zone || module.cluster))
        .map((module) => module.id);
    if (missingZones.length > 0) {
        problems.push(
            `Modules missing topology zone/cluster: ${missingZones.join(', ')}`
        );
    }

    const brokenEdges = inventory.edges.filter(
        (edge) =>
            !uniqueModuleIds.has(edge.from) || !uniqueModuleIds.has(edge.to)
    );
    if (brokenEdges.length > 0) {
        problems.push(
            `Edges reference unknown modules: ${brokenEdges.map((edge) => edge.id).join(', ')}`
        );
    }

    const emptyFlows = inventory.flows
        .filter((flow) => flow.modules.length === 0 && flow.edges.length === 0)
        .map((flow) => flow.id);
    if (emptyFlows.length > 0) {
        problems.push(`Empty topology flows: ${emptyFlows.join(', ')}`);
    }

    const suspicious = inventory.modules.filter((module) =>
        topologyPublicTextLooksSensitive([
            module.id,
            module.label,
            module.description,
            module.route,
            module.externalSystem
        ])
    );
    if (suspicious.length > 0) {
        problems.push(
            `Topology public text may expose sensitive data: ${suspicious.map((module) => module.id).join(', ')}`
        );
    }

    if (problems.length > 0) {
        return {
            gate: 'topology-metadata-quality',
            passed: false,
            message: problems.join('\n')
        };
    }

    return {
        gate: 'topology-metadata-quality',
        passed: true,
        message: `${inventory.totals.modules} modules, ${inventory.totals.edges} edges, ${inventory.totals.flows} flows validated.`
    };
}

function topologyPublicTextLooksSensitive(values: readonly string[]): boolean {
    const text = values.filter(Boolean).join(' ').toLowerCase();
    if (!text) return false;
    return [
        /secret/,
        /password/,
        /passwd/,
        /private[_ -]?key/,
        /token/,
        /bearer /,
        /shelly[a-f0-9]{12,}/,
        /[a-f0-9]{32,}/
    ].some((pattern) => pattern.test(text));
}

// --- Runner --------------------------------------------------------------

async function main() {
    const results: GateResult[] = [
        await gateBaselineDrift(),
        await gateHostContract(),
        gateSystemGrowth(),
        gateComponentRegistration(),
        gateResponseSchemaSnapshot(),
        gateTransportAuthExplicitness(),
        gateImportDiscipline(),
        gateSocketClose(),
        gateArchitecturalInvariants(),
        gateRefreshBoundaries(),
        gateTopologyMetadataQuality()
    ];

    let anyFailed = false;
    for (const r of results) {
        const icon = r.passed ? 'PASS' : 'FAIL';
        console.log(`[${icon}] ${r.gate}: ${r.message}`);
        if (!r.passed) anyFailed = true;
    }

    if (anyFailed) {
        console.log('');
        console.log('One or more CI gates failed. See messages above.');
        process.exit(1);
    }
    console.log('');
    console.log('All Phase 0a CI gates passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void main();
}
