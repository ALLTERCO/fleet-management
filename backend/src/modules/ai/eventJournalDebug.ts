import {getLogger} from 'log4js';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';

const logger = getLogger('mcp-event-journal');
const REFRESH_INTERVAL_MS = 15_000;

// Journaled only while the device is in debug: frames sent with every
// message, and Shelly.Presence, which repeats the Shelly.Disconnect that
// follows it on every socket close.
const ROUTINE_DEVICE_EVENTS = new Set([
    'Shelly.Status',
    'Shelly.Message',
    'Shelly.PresenceTrack',
    'Shelly.Presence'
]);

interface DebugRow {
    organization_id: string;
    device_id: string;
    expires_at: string | Date;
}

// Key "org\ndevice" -> expiry in ms. The database is the source of truth.
let debugUntil = new Map<string, number>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let activeRefresh: Promise<void> | undefined;
// Sets made while a refresh runs, so its older read cannot undo them.
let setSequence = 0;
const recentSets = new Map<string, {until: number | null; sequence: number}>();

function debugKey(organizationId: string, deviceId: string): string {
    return `${organizationId}\n${deviceId}`;
}

export function shouldJournalDeviceEvent(
    organizationId: string,
    deviceId: string,
    eventType: string,
    nowMs: number = Date.now()
): boolean {
    if (!ROUTINE_DEVICE_EVENTS.has(eventType)) return true;
    const until = debugUntil.get(debugKey(organizationId, deviceId));
    return until !== undefined && until > nowMs;
}

export async function setDeviceJournalDebug(input: {
    organizationId: string;
    deviceId: string;
    minutes: number;
    userId?: string;
}): Promise<{until: string | null}> {
    const result = await PostgresProvider.callMethod(
        'fm.fn_event_journal_debug_set',
        {
            p_organization_id: input.organizationId,
            p_device_id: input.deviceId,
            p_minutes: input.minutes,
            p_user_id: input.userId ?? null
        }
    );
    const value = result?.rows?.[0]?.expires_at as string | Date | null;
    const key = debugKey(input.organizationId, input.deviceId);
    const until = value ? new Date(value) : null;
    recentSets.set(key, {
        until: until ? until.getTime() : null,
        sequence: ++setSequence
    });
    if (until) debugUntil.set(key, until.getTime());
    else debugUntil.delete(key);
    return {until: until ? until.toISOString() : null};
}

export async function refreshJournalDebug(): Promise<void> {
    const startSequence = setSequence;
    try {
        const rows = await PostgresProvider.queryRows<DebugRow>(
            'SELECT organization_id, device_id, expires_at FROM fm.fn_event_journal_debug_active()'
        );
        const next = new Map<string, number>();
        for (const row of rows) {
            next.set(
                debugKey(row.organization_id, row.device_id),
                new Date(row.expires_at).getTime()
            );
        }
        for (const [key, set] of recentSets) {
            if (set.sequence <= startSequence) {
                recentSets.delete(key);
            } else if (set.until === null) {
                next.delete(key);
            } else {
                next.set(key, set.until);
            }
        }
        debugUntil = next;
    } catch (error) {
        Observability.incrementCounter(
            'mcp_event_journal_debug_refresh_errors'
        );
        logger.warn(
            'event journal debug refresh failed: %s',
            error instanceof Error ? error.message : String(error)
        );
    }
}

function scheduleRefresh(): Promise<void> {
    if (activeRefresh) return activeRefresh;
    activeRefresh = refreshJournalDebug().finally(() => {
        activeRefresh = undefined;
    });
    return activeRefresh;
}

export function startJournalDebugRefresh(): void {
    if (refreshTimer) return;
    void scheduleRefresh();
    refreshTimer = setInterval(
        () => void scheduleRefresh(),
        REFRESH_INTERVAL_MS
    );
    refreshTimer.unref?.();
}

export async function stopJournalDebugRefresh(): Promise<void> {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    if (activeRefresh) await activeRefresh;
}

export function __resetJournalDebugForTests(): void {
    debugUntil = new Map();
    recentSets.clear();
}
