import * as log4js from 'log4js';
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
    | 'device_delete';

export interface AuditLogEntry {
    eventType: AuditEventType;
    username?: string;
    shellyId?: string;
    method?: string;
    params?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
    ipAddress?: string;
}

export interface AuditLogRow {
    id: number;
    ts: Date;
    event_type: string;
    username: string | null;
    shelly_id: string | null;
    method: string | null;
    params: Record<string, any>;
    success: boolean;
    error_message: string | null;
    ip_address: string | null;
}

// Queue for batching audit log writes to avoid overwhelming the connection pool
const auditLogQueue: AuditLogEntry[] = [];
let flushInProgress = false;
const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE = 100;

// Flush the audit log queue periodically
setInterval(flushAuditLogQueue, FLUSH_INTERVAL_MS);

async function flushAuditLogQueue(): Promise<void> {
    if (flushInProgress || auditLogQueue.length === 0) {
        return;
    }

    if (Observability.isDbWritesDisabled()) {
        Observability.incrementCounter('audit_flushes_skipped');
        auditLogQueue.length = 0;
        return;
    }

    flushInProgress = true;
    Observability.incrementCounter('audit_flushes');
    const entriesToWrite = auditLogQueue.splice(0, auditLogQueue.length);

    const auditFlushStart = performance.now();
    for (const entry of entriesToWrite) {
        try {
            await PostgresProvider.callMethod('logging.fn_audit_log_add', {
                p_event_type: entry.eventType,
                p_username: entry.username || null,
                p_shelly_id: entry.shellyId || null,
                p_method: entry.method || null,
                p_params: entry.params ? JSON.stringify(entry.params) : null,
                p_success: entry.success ?? true,
                p_error_message: entry.errorMessage || null,
                p_ip_address: entry.ipAddress || null
            });
        } catch (err) {
            logger.error('Failed to write audit log:', err);
            Observability.incrementCounter('audit_write_errors');
        }
    }
    Observability.recordDbTiming(
        'audit_flush',
        performance.now() - auditFlushStart
    );

    flushInProgress = false;
}

export async function log(entry: AuditLogEntry): Promise<number | null> {
    Observability.incrementCounter('audit_entries');
    // Add to queue instead of writing immediately
    auditLogQueue.push(entry);

    // If queue is getting too large, trigger an early flush
    if (auditLogQueue.length >= MAX_QUEUE_SIZE && !flushInProgress) {
        flushAuditLogQueue();
    }

    return null;
}

export async function query(params: {
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
        return [];
    }
}

// Convenience methods
export function logLogin(
    username: string,
    ipAddress?: string,
    success = true,
    errorMessage?: string
) {
    return log({
        eventType: 'login',
        username,
        ipAddress,
        success,
        errorMessage
    });
}

export function logRpc(
    username: string | undefined,
    method: string,
    params?: any,
    success = true,
    errorMessage?: string
) {
    // Skip logging params for sensitive methods
    const safeParams = method.toLowerCase().includes('password')
        ? undefined
        : params;

    return log({
        eventType: 'rpc',
        username,
        method,
        params: safeParams,
        success,
        errorMessage
    });
}

export function logDeviceOnline(shellyId: string) {
    return log({eventType: 'device_online', shellyId});
}

export function logDeviceOffline(shellyId: string) {
    return log({eventType: 'device_offline', shellyId});
}

export function logDeviceAdd(shellyId: string, username?: string) {
    return log({eventType: 'device_add', shellyId, username});
}

export function logDeviceDelete(shellyId: string, username?: string) {
    return log({eventType: 'device_delete', shellyId, username});
}

// Methods that should not be logged (high frequency or read-only)
const SKIP_METHODS = new Set([
    'device.list',
    'device.getstatus',
    'device.getconfig',
    'device.getinfo',
    'storage.getitem',
    'storage.getall',
    'storage.keys',
    'fleetmanager.getstatus',
    'fleetmanager.getconfig',
    'entity.list',
    'entity.getstatus',
    'group.list',
    'group.get',
    'auditlog.query',
    'auditlog.export',
    'user.getme',
    'waitingroom.list'
]);

export function shouldLogRpc(method: string): boolean {
    return !SKIP_METHODS.has(method.toLowerCase());
}

// Export flush function for shutdown cleanup
export async function flush(): Promise<void> {
    await flushAuditLogQueue();
}

// Get queue length for monitoring
export function getQueueLength(): number {
    return auditLogQueue.length;
}

// Register observability module stats
Observability.registerModule('audit', () => ({
    queueLength: auditLogQueue.length
}));
