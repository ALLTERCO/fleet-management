// MCP governance policy read from env: read-only mode, allowed clients,
// per-user read/write rate budgets, and single-use confirmation tokens.
// Kept out of the tool core so the policy has one home.

import {tuning} from '../../config/tuning';
import {McpError} from './mcpErrors.js';

// tuning.mcp is hot-readable, so limits change without a process restart.
function budgetFor(kind: 'read' | 'write'): number {
    return kind === 'read' ? tuning.mcp.readsPerMin : tuning.mcp.writesPerMin;
}

// How much of the admin's power MCP exposes. read = reads only; write = reads
// plus non-sensitive writes; full = anything the admin can do (sensitive too).
// RBAC, the confirm step, and the audit trail apply at every level.
export type McpLevel = 'read' | 'write' | 'full';

const LEVEL_RANK: Record<McpLevel, number> = {read: 0, write: 1, full: 2};

export function levelAllowsWrite(level: McpLevel): boolean {
    return level !== 'read';
}

// Only 'full' reaches sensitive namespaces (credentials, firmware, backup, ...).
export function levelAllowsSensitive(level: McpLevel): boolean {
    return level === 'full';
}

// A scoped key is for MCP when its audience carries an `mcp` scope. The scope
// also names the level: `mcp:read` | `mcp:write` | `mcp:full` (bare `mcp` = the
// safe read). This is the GitLab pattern — read/write is baked into the scope
// name, like `read_api` vs `api`. Returns the level, or null if not for MCP.
export function mcpLevelFromAudience(
    audience: string[] | undefined
): McpLevel | null {
    if (!Array.isArray(audience)) return null;
    let best: McpLevel | null = null;
    for (const raw of audience) {
        const value = String(raw).trim().toLowerCase();
        const level: McpLevel | undefined =
            value === 'mcp'
                ? 'read'
                : value === 'mcp:read'
                  ? 'read'
                  : value === 'mcp:write'
                    ? 'write'
                    : value === 'mcp:full'
                      ? 'full'
                      : undefined;
        if (value.startsWith('mcp:') && !level) return null;
        if (!level) continue;
        // Several mcp scopes on one key resolve to the most permissive.
        if (best === null || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
    }
    return best;
}

export function hasMcpAudience(audience: string[] | undefined): boolean {
    return (
        Array.isArray(audience) &&
        audience.some((raw) => {
            const value = String(raw).trim().toLowerCase();
            return value === 'mcp' || value.startsWith('mcp:');
        })
    );
}

// Full-only namespaces. These manage identity, trust, infrastructure, or
// cross-tenant state. RBAC and write confirmation still apply at full level.
const SENSITIVE_NAMESPACES = new Set([
    'auth',
    'alexa',
    'audit',
    'user',
    'user_group',
    'permission',
    'assignment',
    'persona',
    'policy',
    'domain_policy',
    'privacy',
    'restrictions',
    'identity',
    'credential',
    'certificate',
    'security',
    'backup',
    'firmware',
    'ota',
    'admin',
    'bill',
    'billing',
    'plugin',
    'storage',
    'deviceingress',
    'discovery',
    'mail',
    'organization',
    'system',
    'waitingroom'
]);

const SENSITIVE_METHODS = new Set([
    'asset.migrateimages',
    'device.replacehardware',
    'virtualdevice.bluetooth.key.clear',
    'virtualdevice.bluetooth.key.setref'
]);

export function isSensitiveNamespace(namespace: string): boolean {
    return SENSITIVE_NAMESPACES.has(namespace.toLowerCase());
}

export function isSensitiveMethod(namespace: string, method: string): boolean {
    return (
        isSensitiveNamespace(namespace) ||
        SENSITIVE_METHODS.has(method.toLowerCase())
    );
}

// Empty allowlist means all clients are allowed. When enabled, scoped keys
// bind the header to an audience entry such as `mcp-client:codex`.
export function clientAllowed(
    clientId: string | undefined,
    audience?: string[]
): boolean {
    const raw = tuning.mcp.allowedClients.trim();
    if (!raw) return true;
    const allowed = raw.split(',').map((c) => c.trim());
    if (typeof clientId !== 'string' || !allowed.includes(clientId)) {
        return false;
    }
    if (!hasMcpAudience(audience)) return true;
    return audience?.includes(`mcp-client:${clientId}`) ?? false;
}

export function attributedMcpClient(
    clientId: string | undefined,
    audience: string[] | undefined
): string | undefined {
    if (!clientId || !Array.isArray(audience)) return undefined;
    return audience.includes(`mcp-client:${clientId}`) ? clientId : undefined;
}

// --- Per-user read/write rate budget (fixed window, in-memory) ---------

interface Window {
    count: number;
    resetAt: number;
}
const readWindows = new Map<string, Window>();
const writeWindows = new Map<string, Window>();

function consume(
    map: Map<string, Window>,
    user: string,
    limit: number,
    kind: 'read' | 'write'
): void {
    const now = Date.now();
    // Drop windows that have fully expired so the map can't grow unbounded
    // across many distinct agent identities over a long-lived process.
    for (const [seen, win] of map) {
        if (now >= win.resetAt) map.delete(seen);
    }
    const win = map.get(user);
    if (!win || now >= win.resetAt) {
        map.set(user, {count: 1, resetAt: now + 60_000});
        return;
    }
    if (win.count >= limit) {
        throw new McpError(
            'rate_limited',
            `MCP ${kind} rate budget exceeded (${limit}/min)`,
            {retryable: true}
        );
    }
    win.count += 1;
}

export function consumeRateBudget(user: string, kind: 'read' | 'write'): void {
    const map = kind === 'read' ? readWindows : writeWindows;
    consume(map, user, budgetFor(kind), kind);
}

// --- Single-use confirmation tokens ------------------------------------

const usedTokens = new Map<string, number>();

// Reject a token seen before; otherwise record it until its expiry so a
// confirmed write can never be replayed. Prunes lazily on each call.
export function claimToken(token: string, expiresAtMs: number): void {
    const now = Date.now();
    for (const [seen, exp] of usedTokens) {
        if (exp < now) usedTokens.delete(seen);
    }
    if (usedTokens.has(token)) {
        throw new McpError(
            'invalid_confirmation',
            'confirmationToken already used'
        );
    }
    usedTokens.set(token, expiresAtMs);
}
