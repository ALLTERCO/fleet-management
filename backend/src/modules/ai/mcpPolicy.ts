// Catalog-driven policy: which methods a read/write may touch + the write
// allowlist. The api-catalog is the single source of truth for method shapes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {McpError} from './mcpErrors.js';
import {
    isSecretIssuingMethod,
    isSensitiveMethod,
    levelAllowsDeviceControl,
    levelAllowsSensitive,
    type McpLevel
} from './mcpGovernance.js';
import {
    type McpRoleSelection,
    mcpRoleAllowsNamespace,
    roleOwningNamespace
} from './mcpRoles.js';

// Four levels up from both src/modules/ai and dist/modules/ai.
const API_CATALOG_PATH = path.resolve(
    __dirname,
    '../../../..',
    'docs/generated/api-catalog.json'
);

export interface CatalogEntry {
    id: string;
    namespace: string;
    fullMethod: string;
    description?: string;
    namespaceDescription?: string;
    namespaceKind: 'device' | 'fleet-manager';
    escapeHatch?: boolean;
    paramsSchema?: unknown;
    permission: {component?: string; operation?: string};
    safety: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        effectDependsOnInput?: boolean;
    };
}

// The catalog is 3.6MB and changes only at deploy, but every tool call read
// and re-parsed it two or three times, blocking the same event loop that
// serves every device socket. Cached on the file's mtime so a regenerate is
// still picked up without a restart, and indexed by id so a lookup is not a
// linear scan of 1249 entries.
interface LoadedCatalog {
    methods: CatalogEntry[];
    byId: ReadonlyMap<string, CatalogEntry>;
}
let cached: {mtimeMs: number; catalog: LoadedCatalog} | null = null;

function loadCatalog(): LoadedCatalog {
    const {mtimeMs} = fs.statSync(API_CATALOG_PATH);
    if (cached && cached.mtimeMs === mtimeMs) return cached.catalog;
    const parsed = JSON.parse(fs.readFileSync(API_CATALOG_PATH, 'utf8')) as {
        methods: CatalogEntry[];
    };
    const catalog: LoadedCatalog = {
        methods: parsed.methods,
        byId: new Map(parsed.methods.map((m) => [m.id, m]))
    };
    cached = {mtimeMs, catalog};
    return catalog;
}

export function readCatalog(): {methods: CatalogEntry[]} {
    return loadCatalog();
}

/** Catalog lookup by lowercase method id. The only way to find an entry. */
export function findCatalogEntry(method: string): CatalogEntry | undefined {
    return loadCatalog().byId.get(method.trim().toLowerCase());
}

/** Drops the memo. Tests that write a catalog file need this. */
export function _resetCatalogCacheForTest(): void {
    cached = null;
}

/**
 * A method pages by offset when its params schema declares an `offset` field.
 * Lives here, with the rest of the catalog-schema knowledge, so both fm_read
 * and the curated live tools decide it the same way without importing each
 * other.
 */
export function pagesByOffset(paramsSchema: unknown): boolean {
    const props = (paramsSchema as {properties?: Record<string, unknown>})
        ?.properties;
    return !!props && 'offset' in props;
}

export function requireDottedMethod(
    input: Record<string, unknown> | undefined
): string {
    const name = String(input?.method ?? '')
        .trim()
        .toLowerCase();
    if (!name.includes('.')) throw new Error('method must be Namespace.Method');
    return name;
}

// `device.Call` is a tunnel: `{shellyID, method: "Switch.Set", params: {...}}`.
// Its effect is decided by that inner method name, which is exactly why it
// cannot be previewed as-is — and why refusing it outright was never quite
// right either, since the inner method is usually one the catalog already
// describes in full.
//
// So: unwrap it. Rewrite the request into the method it actually names, and
// let the ordinary policy judge THAT. The caller gains nothing it could not
// already do (the inner method must pass the level, sensitivity, and
// destructive checks on its own merits), and it loses the bypass: an inner
// name the catalog does not know is refused, and a nested `device.Call`
// resolves to `device.Call` and is refused as an escape hatch.
//
// The upshot is that `device.Call` becomes sugar, never a wider door.
export function unwrapDeviceCall(req: {
    method: string;
    params?: Record<string, unknown>;
}): {method: string; params: Record<string, unknown>} {
    const params = req.params ?? {};
    const name = req.method.trim().toLowerCase();
    // device.CallMany is the same tunnel over a list of devices, so it is
    // judged the same way: by the method it names, not by the envelope.
    // Anything else would let the batch reach somewhere the single call
    // could not.
    const many = name === 'device.callmany';
    if (name !== 'device.call' && !many) {
        return {method: req.method, params};
    }
    const outer = many ? 'device.CallMany' : 'device.Call';
    const inner = String(params.method ?? '').trim();
    if (!inner.includes('.')) {
        throw new McpError(
            'invalid_params',
            `${outer} requires a "method" naming the device RPC to run`,
            {tool: 'fm_write', method: outer}
        );
    }
    const innerParams = (params.params ?? {}) as Record<string, unknown>;
    if (typeof innerParams !== 'object' || innerParams === null) {
        throw new McpError(
            'invalid_params',
            `${outer} params must be an object`,
            {tool: 'fm_write', method: outer}
        );
    }
    // The device selector rides on the outer envelope. Keeping shellyIDs on
    // the unwrapped params is what makes the approval bind to the exact set:
    // the same relay method on a different list of lamps is a different
    // action, and must be approved separately.
    return {
        method: inner,
        params: many
            ? {shellyIDs: params.shellyIDs, ...innerParams}
            : {shellyID: params.shellyID, ...innerParams}
    };
}

// Entry for an already-vetted method (plain Error: name checked upstream).
export function catalogEntry(method: string): CatalogEntry {
    const entry = findCatalogEntry(method);
    if (!entry) throw new Error(`Unknown method: ${method}`);
    return entry;
}

// Resolves a method for the generic fm_read / fm_write tools at a capability
// level.
//
// Two different things, often confused:
//   - STRUCTURAL refusals apply at every level, because the action cannot be
//     previewed and so a human cannot be shown what they are approving:
//     escape hatches, and methods whose effect depends on input.
//   - LEVEL gates are capabilities, not exclusions. Device firmware methods
//     and sensitive namespaces are reachable at 'full' and refused below it.
//     A key scoped mcp:full CAN operate hardware; the docs used to claim the
//     opposite and an operator scoping a key read it and believed them.
//   - The ROLE is a third, orthogonal axis: which slice of the product this
//     key works in. It only ever narrows, so it can never widen what the
//     level allows, and its refusal is a routing hint rather than a security
//     event.
//
// What actually SUCCEEDS is still decided by RBAC when the method runs as the
// user. Throws a typed McpError.
export function resolveFmMethod(
    input: Record<string, unknown> | undefined,
    want: 'read' | 'write',
    level: McpLevel,
    role: McpRoleSelection = null
): string {
    const name = requireDottedMethod(input);
    const entry = findCatalogEntry(name);
    const tool = `fm_${want}`;
    if (!entry) {
        throw new McpError('method_not_found', `Unknown method: ${name}`, {
            tool
        });
    }
    if (
        entry.namespaceKind !== 'fleet-manager' &&
        !levelAllowsDeviceControl(level)
    ) {
        throw new McpError(
            'namespace_not_allowed',
            `${entry.fullMethod} is a device (Shelly firmware) method; only the 'full' level operates hardware`,
            {tool, method: entry.fullMethod}
        );
    }
    // Checked after the level, because a role narrows what the level already
    // permits and never the other way round.
    if (!mcpRoleAllowsNamespace(role, entry.namespace)) {
        const owner = roleOwningNamespace(entry.namespace);
        throw new McpError(
            'namespace_not_allowed',
            owner
                ? `${entry.fullMethod} belongs to the '${owner}' role; this key is scoped to '${role}'. Use a key for that role.`
                : `${entry.fullMethod} is outside the '${role}' role's surface.`,
            {tool, method: entry.fullMethod}
        );
    }
    if (
        ['job.cancel', 'job.resume'].includes(entry.fullMethod.toLowerCase()) &&
        ['backup', 'firmware', 'certificate', 'credential'].some(
            (namespace) => !mcpRoleAllowsNamespace(role, namespace)
        )
    ) {
        throw new McpError(
            'namespace_not_allowed',
            'Job controls require access to all controlled job namespaces',
            {tool, method: entry.fullMethod}
        );
    }
    if (entry.escapeHatch || entry.safety.effectDependsOnInput) {
        throw new McpError(
            entry.escapeHatch ? 'escape_hatch' : 'effect_depends_on_input',
            `${entry.fullMethod} is a raw escape hatch, not allowed via ${tool}`,
            {tool, method: entry.fullMethod}
        );
    }
    // Sensitive namespaces (credentials, backups, auth, ...) need the 'full'
    // level; below that they are refused, reads included.
    if (
        isSensitiveMethod(entry.namespace, entry.id) &&
        !levelAllowsSensitive(level)
    ) {
        const verb = want === 'write' ? 'writable' : 'readable';
        throw new McpError(
            'sensitive_namespace',
            `${entry.fullMethod} is sensitive; only the 'full' level is ${verb} here`,
            {tool, method: entry.fullMethod}
        );
    }
    if (isSecretIssuingMethod(entry.fullMethod)) {
        throw new McpError(
            'issues_secret',
            `${entry.fullMethod} hands out a secret; create keys in the Fleet UI`,
            {tool, method: entry.fullMethod}
        );
    }
    if (want === 'read' && !entry.safety.readOnlyHint) {
        throw new McpError(
            'method_not_read_only',
            `${entry.fullMethod} is not read-only; use fm_write`,
            {tool, method: entry.fullMethod}
        );
    }
    if (want === 'write' && entry.safety.readOnlyHint) {
        throw new McpError(
            'method_not_write',
            `${entry.fullMethod} is not a write; use fm_read`,
            {tool, method: entry.fullMethod}
        );
    }
    return entry.fullMethod;
}

// One home for the write policy, used by the prepare AND confirm paths so
// confirm is never a policy bypass. No allowlist: any write the level and RBAC
// allow may run. Returns the canonical method name.
export function assertWritePolicy(
    input: Record<string, unknown> | undefined,
    level: McpLevel,
    role: McpRoleSelection = null
): string {
    return resolveFmMethod(input, 'write', level, role);
}
