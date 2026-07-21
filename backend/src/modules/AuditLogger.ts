import * as log4js from 'log4js';
import {tuning} from '../config';
import {normalizeActor, SYSTEM_ACTOR} from '../types/api/auditActors';
import {writeAuditRow, writeAuditRowBatch} from './audit/writeAuditRow';
import {entryToBatchRow, scrubSensitiveValues} from './auditBatchRow';
import {BoundedQueue} from './boundedQueue';
import * as DeviceCollector from './DeviceCollector';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';

const logger = log4js.getLogger('audit');

export type AuditEventType =
    | 'login'
    | 'logout'
    | 'rpc'
    | 'device_online'
    | 'device_offline'
    | 'device_add'
    | 'device_delete'
    | 'device_reconnect_replace'
    | 'waiting_room_evict'
    | 'auto_admit_via_discovery'
    | 'device_identity_mismatch'
    | 'policy_default_change'
    | 'webhook_failure'
    | 'user_gdpr_erasure'
    | 'authz_grant_revoked'
    | 'notification_config_change'
    | 'notification_test_send'
    | 'notification_manual_retry'
    | 'notification_endpoint_reenable'
    | 'device_ingress'
    | 'rate_limit_exceeded'
    | 'mcp_tool_call';

export interface AuditLogEntry {
    eventType: AuditEventType;
    /** Optional caller-set event time. AuditLogger.log() stamps NOW() if unset.
     *  Preserves the original event time when entries spill through the DLQ
     *  and are drained later. */
    ts?: string;
    username?: string;
    /** Stable Zitadel subject. Username remains a display snapshot. */
    actorUserId?: string;
    /** Primary device for single-device rows — kept for display/back-compat. */
    shellyId?: string;
    /** Every device touched by the row (1 for single, N for bulk). Used
     *  by the GIN-indexed audit_log.shelly_ids column for forensic queries. */
    shellyIds?: string[];
    /** Durable logical Fleet device references. External IDs remain snapshots. */
    deviceId?: number;
    deviceIds?: number[];
    method?: string;
    params?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
    ipAddress?: string;
    organizationId?: string;
}

export interface AuditLogRow {
    id: number;
    ts: Date;
    event_type: string;
    username: string | null;
    shelly_id: string | null;
    shelly_ids: string[] | null;
    device_id: number | null;
    device_ids: number[] | null;
    method: string | null;
    params: Record<string, any>;
    success: boolean;
    error_message: string | null;
    ip_address: string | null;
    organization_id: string | null;
}

interface QueuedAuditEntry extends AuditLogEntry {
    /** Internal — never set by external callers. */
    _retryCount?: number;
}

// Spill-on-drop hook injected after module load to avoid circular imports.
let spillHook: ((entry: AuditLogEntry) => void) | undefined;
export function setAuditSpillHook(hook: (entry: AuditLogEntry) => void): void {
    spillHook = hook;
}

// Hard cap evicts oldest into Redis Streams DLQ — drained back to PG by AuditDrainer.
// Lazy so importing the module is side-effect free. tuning.audit.queueHardMax
// is read on first use, not at import time — tests that reload tuning see the
// updated cap.
let auditLogQueueInstance: BoundedQueue<QueuedAuditEntry> | null = null;
function getAuditLogQueue(): BoundedQueue<QueuedAuditEntry> {
    if (auditLogQueueInstance) return auditLogQueueInstance;
    auditLogQueueInstance = new BoundedQueue<QueuedAuditEntry>({
        maxSize: tuning.audit.queueHardMax,
        overflow: 'drop-oldest',
        onDrop: (_reason, dropped) => {
            Observability.incrementCounter('audit_evicted_oldest');
            spillHook?.(dropped);
        }
    });
    return auditLogQueueInstance;
}
let inFlightFlush: Promise<void> | null = null;

// Periodic flush timer. Armed via startAuditFlushTimer() at boot so that
// importing this module is side-effect-free (tests, scripts, generators).
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function startAuditFlushTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(flushAuditLogQueue, tuning.audit.flushIntervalMs);
    flushTimer.unref?.();
}

export function stopAuditFlushTimer(): void {
    if (!flushTimer) return;
    clearInterval(flushTimer);
    flushTimer = null;
}

// Bumps a counter when log() runs without the timer armed. Ops dashboards
// surface this as `audit_log_unarmed_calls` — non-zero on a live FM
// means startAuditFlushTimer() was forgotten in main(). Counter-only
// (no logger.error) so tests don't get noisy.
function recordUnarmedLogIfAny(): void {
    if (flushTimer) return;
    Observability.incrementCounter('audit_log_unarmed_calls');
}

function recordRowFailure(
    entry: QueuedAuditEntry,
    err: unknown,
    failed: QueuedAuditEntry[]
): void {
    Observability.incrementCounter('audit_write_errors');
    const attempts = (entry._retryCount ?? 0) + 1;
    if (attempts >= tuning.audit.maxRetries) {
        logger.error(
            'Dropping audit entry after %d failed attempts (eventType=%s method=%s): %s',
            tuning.audit.maxRetries,
            entry.eventType,
            entry.method ?? '',
            err
        );
        Observability.incrementCounter('audit_write_dropped');
        return;
    }
    failed.push({...entry, _retryCount: attempts});
}

// Slow-path fallback when the batch insert fails. Each entry runs through
// the legacy single-row fn so one poison entry cannot kill its 99 siblings.
async function flushPerRow(
    entries: QueuedAuditEntry[],
    failed: QueuedAuditEntry[]
): Promise<void> {
    Observability.incrementCounter('audit_per_row_fallbacks');
    let succeeded = 0;
    for (const entry of entries) {
        const row = entryToBatchRow(
            entry,
            tuning.audit.maxParamsChars,
            tuning.audit.persistedErrorMessageMaxChars
        );
        try {
            await writeAuditRow(row);
            succeeded++;
        } catch (err) {
            recordRowFailure(entry, err, failed);
        }
    }
    if (succeeded > 0 || failed.length > 0) {
        logger.warn(
            'Audit per-row fallback: %d succeeded, %d requeued, %d dropped',
            succeeded,
            failed.length,
            entries.length - succeeded - failed.length
        );
    }
}

async function flushAuditLogQueueOnce(): Promise<void> {
    const queue = getAuditLogQueue();
    if (queue.size === 0) return;

    if (Observability.isDbWritesDisabled()) {
        // Hold queue until writes re-enable. BoundedQueue caps memory.
        Observability.incrementCounter('audit_flushes_skipped');
        return;
    }

    Observability.incrementCounter('audit_flushes');
    const entriesToWrite = queue.drain();
    const failed: QueuedAuditEntry[] = [];

    const auditFlushStart = performance.now();
    try {
        await writeAuditRowBatch(
            entriesToWrite.map((e) =>
                entryToBatchRow(
                    e,
                    tuning.audit.maxParamsChars,
                    tuning.audit.persistedErrorMessageMaxChars
                )
            )
        );
    } catch (_batchErr) {
        // Batch failed as a unit — drop into per-row mode to isolate the poison.
        await flushPerRow(entriesToWrite, failed);
    } finally {
        Observability.recordDbTiming(
            'audit_flush',
            performance.now() - auditFlushStart
        );
        for (const f of failed) getAuditLogQueue().push(f);
    }
}

function flushAuditLogQueue(): Promise<void> {
    if (inFlightFlush) return inFlightFlush;
    inFlightFlush = flushAuditLogQueueOnce().finally(() => {
        inFlightFlush = null;
    });
    return inFlightFlush;
}

export async function log(entry: AuditLogEntry): Promise<number | null> {
    recordUnarmedLogIfAny();
    Observability.incrementCounter('audit_entries');
    // Stamp NOW() if caller didn't — preserves event time across spill/drain.
    const owned = attachLogicalDeviceRefs(entry);
    const stamped: AuditLogEntry = owned.ts
        ? owned
        : {...owned, ts: new Date().toISOString()};
    const queue = getAuditLogQueue();
    queue.push(stamped);

    if (queue.size >= tuning.audit.queueMax && !inFlightFlush) {
        void flushAuditLogQueue().catch((err) =>
            logger.error('audit flush failed: %s', err)
        );
    }

    return null;
}

function attachLogicalDeviceRefs(entry: AuditLogEntry): AuditLogEntry {
    if (entry.deviceId !== undefined || entry.deviceIds !== undefined) {
        return entry;
    }
    const externalIds =
        entry.shellyIds && entry.shellyIds.length > 0
            ? entry.shellyIds
            : entry.shellyId
              ? [entry.shellyId]
              : [];
    if (externalIds.length === 0) return entry;
    const logicalIds = externalIds.map(
        (externalId) => DeviceCollector.getDevice(externalId)?.id
    );
    if (logicalIds.some((id) => id === undefined)) return entry;
    const deviceIds = logicalIds as number[];
    return {
        ...entry,
        deviceId: deviceIds.length === 1 ? deviceIds[0] : undefined,
        deviceIds
    };
}

export async function query(params: {
    organizationId: string | null;
    from?: Date;
    to?: Date;
    eventTypes?: AuditEventType[];
    username?: string;
    shellyId?: string;
    limit?: number;
    offset?: number;
}): Promise<AuditLogRow[]> {
    try {
        const result = await PostgresProvider.callMethod(
            'logging.fn_audit_log_query',
            {
                p_organization_id: params.organizationId,
                p_from: params.from?.toISOString() || null,
                p_to: params.to?.toISOString() || null,
                p_event_types: params.eventTypes || null,
                p_username: params.username || null,
                p_shelly_id: params.shellyId || null,
                p_limit: params.limit ?? 10000,
                p_offset: params.offset ?? 0
            }
        );
        return result?.rows ?? [];
    } catch (err) {
        logger.error('Failed to query audit log:', err);
        throw err;
    }
}

/** OWASP API4:2023 — record rate-limit rejections for forensic detection of
 *  brute-force / scraping patterns. Bounded by the audit queue (drop-oldest
 *  spills to DLQ), so a flood attacker can't blow the log. */
export function logRateLimitExceeded(args: {
    username?: string;
    method: string;
    scope: 'user' | 'organization' | 'http_route';
    ipAddress?: string;
    organizationId?: string | null;
}): Promise<number | null> {
    return log({
        eventType: 'rate_limit_exceeded',
        username: args.username ? normalizeActor(args.username) : undefined,
        method: args.method,
        params: {scope: args.scope},
        success: false,
        ipAddress: args.ipAddress,
        organizationId: args.organizationId ?? undefined
    });
}

export interface LoginAuditInput {
    username: string;
    actorUserId?: string;
    ipAddress?: string;
    success?: boolean;
    errorMessage?: string;
    organizationId?: string;
}

export function buildLoginAuditEvent(input: LoginAuditInput): AuditLogEntry {
    return {
        eventType: 'login',
        username: normalizeActor(input.username),
        actorUserId: input.actorUserId,
        ipAddress: input.ipAddress,
        success: input.success ?? true,
        errorMessage: input.errorMessage,
        organizationId: input.organizationId
    };
}

// Positional wrapper retained for existing authentication call sites.
export function logLogin(
    username: string,
    ipAddress?: string,
    success = true,
    errorMessage?: string,
    organizationId?: string,
    actorUserId?: string
) {
    return log(
        buildLoginAuditEvent({
            username,
            ipAddress,
            success,
            errorMessage,
            organizationId,
            actorUserId
        })
    );
}

// Methods whose params must never be logged (auth, tokens, secrets)
const SENSITIVE_METHODS = new Set([
    'user.authenticate',
    'user.refresh',
    'user.rotatetoken',
    'user.authenticatealexa',
    'user.refreshalexa',
    'user.create',
    'user.changepassword',
    'user.resetpassword',
    'user.createserviceuser',
    'user.createpat',
    'user.revokepat',
    'plugin.upload',
    'pluginmgr.upload'
]);

// Alias dispatch rewrites method strings to `old (→new)`. Strip before lookup.
function canonicalMethod(method: string): string {
    const space = method.indexOf(' ');
    return (space > 0 ? method.slice(0, space) : method).toLowerCase();
}

export function redactSensitiveParams(
    method: string,
    params: any
): Record<string, any> | undefined {
    if (!params || typeof params !== 'object') return params;
    if (SENSITIVE_METHODS.has(canonicalMethod(method))) return undefined;
    // One home for deep param redaction — shared with audit persistence so the
    // WS debug log and the stored row scrub the same keys (incl. nested).
    return scrubSensitiveValues(params) as Record<string, any>;
}

/** Every shellyID referenced by RPC params (single or bulk). */
function extractShellyIds(params: any): string[] {
    if (!params || typeof params !== 'object') return [];
    const out: string[] = [];
    if (typeof params.shellyID === 'string') out.push(params.shellyID);
    if (Array.isArray(params.shellyIDs)) {
        for (const id of params.shellyIDs) {
            if (typeof id === 'string') out.push(id);
        }
    }
    return out;
}

export interface RpcAuditInput {
    username?: string;
    actorUserId?: string;
    method: string;
    params?: any;
    success?: boolean;
    errorMessage?: string;
    organizationId?: string;
    ipAddress?: string;
}

export function buildRpcAuditEvent(input: RpcAuditInput): AuditLogEntry {
    const safeParams = redactSensitiveParams(input.method, input.params);
    const ids = extractShellyIds(input.params);

    return {
        eventType: 'rpc',
        username: normalizeActor(input.username),
        actorUserId: input.actorUserId,
        method: input.method,
        params: safeParams,
        shellyId: ids.length === 1 ? ids[0] : undefined,
        shellyIds: ids,
        success: input.success ?? true,
        errorMessage: input.errorMessage,
        organizationId: input.organizationId,
        ipAddress: input.ipAddress
    };
}

export function logRpc(input: RpcAuditInput) {
    return log(buildRpcAuditEvent(input));
}

// MCP doorway audit: which agent tool ran, on which method, and whether
// it was allowed. Complements the RPC-level 'rpc' event that Commander
// writes for the underlying call.
export interface McpAuditArgs {
    username?: string;
    tool: string;
    method?: string;
    success: boolean;
    errorMessage?: string;
    organizationId?: string | null;
    // Attribution: which agent credential + client, so an agent-token call is
    // distinguishable from the user's browser session. Not secrets.
    credentialId?: string;
    clientId?: string;
    // 'prepare' = preview only (nothing ran); 'execute' = the write ran. Lets
    // the trail tell a planned fm_write apart from one that changed data.
    phase?: 'prepare' | 'execute';
}

// Pure builder, split from enqueueing so the event shape is unit-testable.
export function buildMcpAuditEvent(args: McpAuditArgs): AuditLogEntry {
    const params: Record<string, unknown> = {};
    if (args.credentialId) params.credentialId = args.credentialId;
    if (args.clientId) params.clientId = args.clientId;
    if (args.phase) params.phase = args.phase;
    return {
        eventType: 'mcp_tool_call',
        username: normalizeActor(args.username),
        method: args.method ? `${args.tool}:${args.method}` : args.tool,
        params: Object.keys(params).length > 0 ? params : undefined,
        success: args.success,
        errorMessage: args.errorMessage,
        organizationId: args.organizationId ?? undefined
    };
}

export function logMcpTool(args: McpAuditArgs) {
    return log(buildMcpAuditEvent(args));
}

export function logDeviceOnline(shellyId: string) {
    return log({
        eventType: 'device_online',
        username: SYSTEM_ACTOR,
        shellyId,
        shellyIds: [shellyId]
    });
}

/** Battery/sleep-mode devices go offline between reports by design. */
function isBatteryPoweredDevice(shellyId: string): boolean {
    const device = DeviceCollector.getDevice(shellyId);
    if (!device) return false;
    const status = device.status as any;
    if (!status) return false;
    if (status.devicepower) return true;
    if (status.sys?.wakeup_period > 0) return true;
    return false;
}

export function logDeviceOffline(shellyId: string) {
    if (isBatteryPoweredDevice(shellyId)) return;
    return log({
        eventType: 'device_offline',
        username: SYSTEM_ACTOR,
        shellyId,
        shellyIds: [shellyId]
    });
}

export function logDeviceAdd(shellyId: string, username?: string) {
    return log({
        eventType: 'device_add',
        username: normalizeActor(username),
        shellyId,
        shellyIds: [shellyId]
    });
}

export function logDeviceDelete(shellyId: string, username?: string) {
    return log({
        eventType: 'device_delete',
        username: normalizeActor(username),
        shellyId,
        shellyIds: [shellyId]
    });
}

export function logWaitingRoomEvict(
    shellyId: string,
    reason: 'lru' | 'ttl' | 'duplicate'
) {
    return log({
        eventType: 'waiting_room_evict',
        username: SYSTEM_ACTOR,
        shellyId,
        shellyIds: [shellyId],
        params: {reason}
    });
}

// Discovery.AdmitDevice intent matched on reconnect → device auto-admitted
// into the requesting org without operator interaction. Forensic record.
export function logAutoAdmitViaDiscovery(input: {
    shellyId: string;
    organizationId: string;
    groupId: number | null;
    createdBy: string | null;
}) {
    return log({
        eventType: 'auto_admit_via_discovery',
        username: SYSTEM_ACTOR,
        shellyId: input.shellyId,
        shellyIds: [input.shellyId],
        organizationId: input.organizationId,
        params: {
            intent_org: input.organizationId,
            intent_group: input.groupId,
            intent_created_by: input.createdBy
        }
    });
}

// Old in-memory device displaced by a new connection with the same shellyID.
export function logDeviceReconnectReplace(
    shellyId: string,
    params: Record<string, unknown>
) {
    return log({
        eventType: 'device_reconnect_replace',
        username: SYSTEM_ACTOR,
        shellyId,
        shellyIds: [shellyId],
        params
    });
}

// Audit-log opt-out is now per-method, declared at the component level
// via `@Component.NoAudit`. Commander reads `component.shouldAuditMethod`
// before emitting a log entry — no central skip-list. See
// `backend/src/model/component/Component.ts` for the decorator and
// per-component overrides (e.g. DeviceComponent.list, EntityComponent.list,
// FleetComponent.getMetrics). Energy.Query / Energy.Current are
// deliberately NOT decorated — they are the forensic trail for
// "who queried which device's energy data" and must be retained for
// GDPR / customer-audit queries.

// Export flush function for shutdown cleanup
export async function flush(): Promise<void> {
    do {
        await flushAuditLogQueue();
    } while (getAuditLogQueue().size > 0);
}

// Get queue length for monitoring
export function getQueueLength(): number {
    return getAuditLogQueue().size;
}

Observability.registerModule('audit', {
    stats: () => ({
        queueLength: getAuditLogQueue().size
    }),
    topology: {
        role: 'transform',
        cluster: 'storage',
        upstreams: ['wsCommands'],
        downstreams: ['dbPool'],
        label: 'Audit Log',
        description: 'Audit trail writer',
        route: '/monitoring/audit-log'
    }
});
