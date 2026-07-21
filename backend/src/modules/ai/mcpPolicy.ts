// Catalog-driven policy: which methods a read/write may touch + the write
// allowlist. The api-catalog is the single source of truth for method shapes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {McpError} from './mcpErrors.js';
import {
    isSensitiveMethod,
    levelAllowsSensitive,
    type McpLevel
} from './mcpGovernance.js';

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

export function readCatalog(): {methods: CatalogEntry[]} {
    return JSON.parse(fs.readFileSync(API_CATALOG_PATH, 'utf8')) as {
        methods: CatalogEntry[];
    };
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

// Entry for an already-vetted method (plain Error: name checked upstream).
export function catalogEntry(method: string): CatalogEntry {
    const entry = readCatalog().methods.find(
        (m) => m.id === method.toLowerCase()
    );
    if (!entry) throw new Error(`Unknown method: ${method}`);
    return entry;
}

// Resolves a method for the generic fm_read / fm_write tools at a capability
// level. Structural refusals always apply (device methods, escape hatches, raw
// tunnels) — MCP proxies governed FM methods, never a raw RPC pipe. Sensitive
// namespaces are refused below 'full'. What actually SUCCEEDS is still decided
// by RBAC when the method runs as the user. Throws a typed McpError.
export function resolveFmMethod(
    input: Record<string, unknown> | undefined,
    want: 'read' | 'write',
    level: McpLevel
): string {
    const name = requireDottedMethod(input);
    const entry = readCatalog().methods.find((method) => method.id === name);
    const tool = `fm_${want}`;
    if (!entry) {
        throw new McpError('method_not_found', `Unknown method: ${name}`, {
            tool
        });
    }
    if (entry.namespaceKind !== 'fleet-manager') {
        throw new McpError(
            'namespace_not_allowed',
            `${entry.fullMethod} is a device (Shelly firmware) method; ${tool} only serves Fleet Manager methods`,
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
    level: McpLevel
): string {
    return resolveFmMethod(input, 'write', level);
}
