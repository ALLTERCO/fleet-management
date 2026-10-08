// MCP governance policy read from env: read-only mode, allowed clients,
// per-user read/write rate budgets, device commands in flight per tenant, and
// single-use confirmation tokens.
// Kept out of the tool core so the policy has one home.

import {createHash} from 'node:crypto';
import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import type {
    McpConfirmationClaim,
    McpConfirmationClaimOutcome
} from '../redis/ports';
import {McpError} from './mcpErrors.js';

const logger = getLogger('mcpGovernance');

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

// Only 'full' operates the hardware itself (switch.Set, shelly.Reboot, ...).
// These carry real schemas and safety flags, so they preview and confirm like
// any other write; the raw tunnels that cannot be previewed stay refused at
// every level, in resolveFmMethod.
export function levelAllowsDeviceControl(level: McpLevel): boolean {
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

/**
 * The level of a credential issued for this MCP server, or null for any other.
 *
 * The spec forbids accepting a token that was not issued for the server, so a
 * browser session or an unscoped key is refused whatever its owner's role.
 * Two sources qualify: a Fleet scoped key whose audience names MCP, and an
 * OAuth access token Zitadel issued to one of the MCP apps (the resolver gives
 * it the app's client id and the audience of the app's level). The instance
 * read-only switch (FM_MCP_READ_ONLY) clamps every one of them to read.
 */
export function mcpIssuedCredentialLevel(
    credential:
        | {
              credentialId?: string;
              credentialClientId?: string;
              credentialAudience?: string[];
          }
        | undefined
): McpLevel | null {
    if (!credential?.credentialId && !credential?.credentialClientId) {
        return null;
    }
    const level = mcpLevelFromAudience(credential.credentialAudience);
    // Decided here so tools/list, every write gate and confirm all follow it.
    return level && tuning.mcp.readOnly ? 'read' : level;
}

/** Where the MCP router is mounted. The one place this path is decided. */
export const MCP_MOUNT_PATH = '/mcp';

/**
 * An MCP credential may only be used on the MCP endpoint.
 *
 * This is the whole rule, and it is deliberately transport-blind so that every
 * way into the process asks the same question. The two wrappers below answer it
 * for the two transports we actually have; a third transport must add a
 * wrapper here rather than grow its own check.
 *
 * `mcpPath` is the endpoint the request arrived on, or null when the transport
 * has no notion of an MCP endpoint — which is itself the answer: it is not MCP,
 * so an MCP credential does not belong on it.
 */
function mcpCredentialAllows(
    audience: string[] | undefined,
    mcpPath: string | null
): boolean {
    if (!hasMcpAudience(audience)) return true;
    if (mcpPath === null) return false;
    return (
        mcpPath === MCP_MOUNT_PATH || mcpPath.startsWith(`${MCP_MOUNT_PATH}/`)
    );
}

/** HTTP: an MCP credential is confined to the MCP router's own paths. */
export function mcpCredentialAllowsHttpPath(
    audience: string[] | undefined,
    path: string
): boolean {
    return mcpCredentialAllows(audience, path);
}

/**
 * Client WebSocket: never MCP, so an MCP credential is always refused.
 *
 * Without this an `mcp:read` key opened an ordinary socket and reached the
 * user's entire RPC surface — writes, sensitive namespaces, the device relay —
 * with no rate budget, no kill switch and no MCP audit row.
 */
export function mcpCredentialAllowsClientSocket(
    audience: string[] | undefined
): boolean {
    return mcpCredentialAllows(audience, null);
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
    'filetransfer',
    'ota',
    'admin',
    'bill',
    'billing',
    'plugin',
    'storage',
    'deviceingress',
    'discovery',
    'mail',
    'mcp_approval',
    'organization',
    'system',
    'waitingroom'
]);

const SENSITIVE_METHODS = new Set([
    'scopedautomation.create',
    'scopedautomation.update',
    'scopedautomation.delete',
    'scopedautomation.run',
    'job.cancel',
    'job.resume',
    'asset.migrateimages',
    'automation.create',
    'automation.update',
    'automation.setenabled',
    'automation.delete',
    'automation.graph.create',
    'automation.graph.update',
    'automation.graph.delete',
    'device.replacehardware',
    'virtualdevice.bluetooth.key.clear',
    'virtualdevice.bluetooth.key.setref'
]);

/**
 * Methods that hand out durable access, or admit something into the fleet.
 *
 * None of these delete anything, so `destructiveHint` is false for all of them
 * and they used to execute with no human in the loop at all. That let an agent
 * holding a short-lived key call `user.CreateScopedPAT` with
 * `audience:['mcp:full']` and a year's expiry — turning temporary access into
 * permanent access, silently.
 *
 * These are also the one class of action a standing approval must never cover:
 * "always allow" plus "mint a credential" is the same hole with an extra step.
 */
const CREDENTIAL_METHODS = new Set([
    'user.createscopedpat',
    'user.createpat',
    'user.rotatepat',
    'user.rotatescopedpat',
    'user.bulkrotatepats',
    'user.createserviceuser',
    'user.createzitadeluser',
    'auth.mintscopedtoken',
    'identity.addoidcprovider',
    'certificate.signcsr',
    'certificate.issuedevicecert',
    'certificate.import',
    'plugin.upload',
    'waitingroom.acceptallstart',
    'waitingroom.acceptbulkstart',
    'discovery.admitdevice'
]);

/**
 * Credential methods whose result is a secret. Never reachable over MCP: the
 * secret would land in the AI provider's transcript. People mint keys in the UI.
 */
const SECRET_ISSUING_METHODS = new Set([
    'user.createscopedpat',
    'user.createpat',
    'user.rotatepat',
    'user.rotatescopedpat',
    'user.bulkrotatepats',
    'auth.mintscopedtoken'
]);

export function isSecretIssuingMethod(method: string): boolean {
    return SECRET_ISSUING_METHODS.has(method.trim().toLowerCase());
}

/** Issues credentials, identity or trust. See CREDENTIAL_METHODS. */
export function isCredentialMethod(method: string): boolean {
    return CREDENTIAL_METHODS.has(method.trim().toLowerCase());
}

/**
 * Writes that start or change a Node-RED automation, with the params that
 * bind a standing approval to one of them.
 *
 * A new flow runs as soon as it is saved and may use any installed node, so
 * creating one is not "additive" in any useful sense. Creates bind to nothing:
 * "stop asking" then covers every new automation, which is the point of it.
 * Changes bind to the automation they touch, so a yes for one flow is not a
 * yes for every flow in the organization.
 */
const AUTOMATION_WRITES: Readonly<Record<string, readonly string[]>> = {
    'automation.graph.create': [],
    'automation.graph.update': ['flowId'],
    'automation.create': [],
    'automation.update': ['flowId'],
    'automation.setenabled': ['flowId', 'enabled'],
    'scopedautomation.create': [],
    'scopedautomation.update': ['id'],
    'scopedautomation.run': ['id']
};

/** Starts or changes an automation. Switching one off is not a start. */
export function isAutomationWrite(
    method: string,
    params: Record<string, unknown>
): boolean {
    const id = method.trim().toLowerCase();
    if (!(id in AUTOMATION_WRITES)) return false;
    return id !== 'automation.setenabled' || params.enabled === true;
}

/** Params that bind a remembered yes, or undefined for the default binding. */
export function automationApprovalBinding(
    method: string
): readonly string[] | undefined {
    return AUTOMATION_WRITES[method.trim().toLowerCase()];
}

/** Automation writes that ask a human, published for fm_capabilities. */
export function automationWriteMethods(): string[] {
    return Object.keys(AUTOMATION_WRITES).sort();
}

/** Automation writes whose remembered yes covers every new automation. */
export function automationCreateMethods(): string[] {
    return automationWriteMethods().filter(
        (method) => AUTOMATION_WRITES[method].length === 0
    );
}

/**
 * Does this write need a human to say yes before it runs?
 *
 * One predicate, so the answer cannot drift between the code that asks for
 * approval and the code that decides whether an approval may be remembered.
 */
export function requiresHumanApproval(
    write: {method: string; params: Record<string, unknown>},
    safety: {destructiveHint: boolean}
): boolean {
    return (
        safety.destructiveHint ||
        isCredentialMethod(write.method) ||
        isAutomationWrite(write.method, write.params)
    );
}

/**
 * May a "yes, always" cover this method?
 *
 * No for anything that issues access: a single remembered approval would let
 * an agent mint credentials forever, which is precisely what the approval was
 * meant to gate.
 */
export function allowsStandingApproval(method: string): boolean {
    return !isCredentialMethod(method);
}

/** The full-only namespaces, published so an agent need not probe for them. */
export function sensitiveNamespaces(): string[] {
    return [...SENSITIVE_NAMESPACES].sort();
}

/** The full-only individual methods, for the same reason. */
export function sensitiveMethods(): string[] {
    return [...SENSITIVE_METHODS].sort();
}

/** Methods that always need a human, whatever the level. */
export function credentialMethods(): string[] {
    return [...CREDENTIAL_METHODS].sort();
}

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

// --- Per-user read/write rate budget (shared token bucket) ------------

/**
 * Spends one call from the user's per-minute budget. The bucket lives in the
 * shared rate-limit store, so every instance and every restart see one count.
 * A store error lets the call through, as for every non-security limit on that
 * store; the per-(user, method) RPC limit still bounds each process then.
 */
export async function consumeRateBudget(
    user: string,
    kind: 'read' | 'write'
): Promise<void> {
    const limit = budgetFor(kind);
    const {rateLimiter} = await redisServices();
    if (await rateLimiter.consume(`mcp:${kind}:${user}`, limit, limit / 60)) {
        return;
    }
    await recordMcpMetric((metrics) => metrics.recordMcpRateBudgetHit(kind));
    throw new McpError(
        'rate_limited',
        `MCP ${kind} rate budget exceeded (${limit}/min)`,
        {retryable: true}
    );
}

// --- Device commands in flight per tenant (shared reservation) --------

/** Device reads and device writes are capped apart. */
export type DeviceCommandClass = 'read' | 'write';

export interface DeviceCommandSlot {
    release(): Promise<void>;
}

/** Held by a command that is not counted: a Fleet method, or a store outage. */
export const UNCOUNTED_DEVICE_COMMAND: DeviceCommandSlot = {
    release: async () => {}
};

function deviceCommandCap(commandClass: DeviceCommandClass): number {
    return commandClass === 'read'
        ? tuning.mcp.deviceReadsInFlight
        : tuning.mcp.deviceWritesInFlight;
}

/** Shared across instances; a store error lets the command through, like the rate budget. */
export async function acquireDeviceCommandSlot(command: {
    organizationId: string | null;
    commandClass: DeviceCommandClass;
    method: string;
}): Promise<DeviceCommandSlot> {
    const cap = deviceCommandCap(command.commandClass);
    const {reservation} = await redisServices();
    const slot = await reservation.reserve(
        `mcp:device-commands:${command.organizationId ?? 'no-organization'}:${command.commandClass}`,
        cap,
        tuning.mcp.deviceCommandSlotTtlSec
    );
    if (slot.ok) return releasedOnce(slot.release);
    if (slot.reason === 'backend_error') return UNCOUNTED_DEVICE_COMMAND;
    throw new McpError(
        'rate_limited',
        `${cap} MCP device ${command.commandClass}s are already running for this organization; retry when one finishes`,
        {
            method: command.method,
            retryable: true,
            details: {
                limit: 'device_commands_in_flight',
                commandClass: command.commandClass,
                cap
            }
        }
    );
}

// A second release would free a slot another command holds.
function releasedOnce(release: () => Promise<void>): DeviceCommandSlot {
    let released = false;
    return {
        release: async () => {
            if (released) return;
            released = true;
            await release();
        }
    };
}

// --- Single-use confirmation tokens ------------------------------------

/**
 * Records a token as used, or refuses it. The claim lives in the shared
 * consent store until the token expires, so no instance can run it twice.
 * When the store cannot be reached the token is refused, never trusted.
 */
export async function claimToken(
    token: string,
    lifetime: {issuedAtMs: number; expiresAtMs: number}
): Promise<void> {
    const outcome = await recordClaim({
        tokenDigest: createHash('sha256').update(token).digest('hex'),
        ...lifetime
    });
    if (outcome === 'already_used') {
        throw new McpError(
            'invalid_confirmation',
            'confirmationToken already used'
        );
    }
    if (outcome === 'predates_store') {
        throw new McpError(
            'invalid_confirmation',
            'confirmationToken was issued before the claim store restarted; prepare again'
        );
    }
}

// Loaded on first use: the docs-only stdio server imports this module through
// the tool core but never spends a budget or confirms a write, and must not
// load the Redis and metrics runtime.
function redisServices(): Promise<typeof import('../redis/services.js')> {
    return import('../redis/services.js');
}

/** Records an MCP metric, loading the metrics runtime on first use. */
export async function recordMcpMetric(
    record: (metrics: typeof import('../observability/mcpMetrics.js')) => void
): Promise<void> {
    record(await import('../observability/mcpMetrics.js'));
}

async function recordClaim(
    claim: McpConfirmationClaim
): Promise<McpConfirmationClaimOutcome> {
    try {
        const {mcpConfirmationClaims} = await redisServices();
        return await mcpConfirmationClaims.claim(claim);
    } catch (error) {
        logger.warn(
            'confirmation claim store unavailable, refusing the token: %s',
            error instanceof Error ? error.message : String(error)
        );
        throw new McpError(
            'operation_unavailable',
            'confirmationToken could not be checked; try again',
            {retryable: true}
        );
    }
}
