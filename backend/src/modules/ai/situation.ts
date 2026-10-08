// "What is going on right now?" in one call.
//
// It GROUPS. Twelve devices offline in one shop is one problem, not twelve. An
// agent handed twelve facts writes twelve sentences; handed one grouped fact,
// it says the useful thing.
//
// Every field read here is a field the API returns. The first version was not:
// it asked for `gatewayExternalId` and an alert state called `'open'`, neither
// of which exists. Nothing threw. It reported a calm fleet while alerts fired.
// The tests pin these shapes to the contract.
//
// Read-only. Acting on what it finds is a write like any other.

import {getLogger} from 'log4js';
import type {shelly_presence_t} from '../../types';
import {ALERT_STATES_NEEDING_ATTENTION} from '../alert/states';

const logger = getLogger('mcpSituation');

export interface SituationDevice {
    /** The device id the rest of the API takes, from `shellyID` on the row. */
    externalId: string;
    name?: string;
    locationId?: number;
    /** The shared fleet-wide presence vocabulary, not a loose string. */
    presence: shelly_presence_t | 'unknown';
}

// Offline means cannot be reached. `pending` is a device still being admitted,
// not a fault; calling it offline sends someone to working hardware.
function isOffline(device: SituationDevice): boolean {
    return device.presence === 'offline';
}

export interface SituationAlert {
    id?: number;
    severity?: string;
    /** The alert's own words. `title` on the wire, not `summary`. */
    title?: string;
    /** What it fired about: a device id, a group id, a location id. */
    subjectId?: string;
    ruleKind?: string;
}

/** One thing worth telling a human about, with the evidence behind it. */
export interface Concern {
    kind: 'site_down' | 'devices_offline' | 'alerts_open';
    /** How much attention it deserves, relative to the others here. */
    severity: 'critical' | 'warning' | 'info';
    headline: string;
    /** What the agent should look at next. Never a guess at the cause. */
    evidence: string[];
    deviceIds: string[];
}

export interface Situation {
    concerns: Concern[];
    checked: {devices: number; offline: number; openAlerts: number};
    /** True when there is genuinely nothing wrong, so an agent can say so. */
    quiet: boolean;
    /**
     * Lookups that failed. "I could not see the alerts" and "there are no
     * alerts" are different sentences. Only one is safe to act on.
     */
    couldNotCheck?: string[];
}

type Executor = (
    method: string,
    params: Record<string, unknown>
) => Promise<unknown>;

function rowsOf(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value as Record<string, unknown>[];
    const items = (value as {items?: unknown})?.items;
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

// Unknown values become 'unknown', not offline. Guessing offline sends someone
// to a site for nothing.
function readPresence(value: unknown): shelly_presence_t | 'unknown' {
    const text = String(value ?? '').toLowerCase();
    return text === 'online' || text === 'offline' || text === 'pending'
        ? (text as shelly_presence_t)
        : 'unknown';
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const RANK: Record<Concern['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2
};

// Records which lookup failed instead of returning an empty list. Silence and
// emptiness look identical to the reader, so they must not report identically.
async function tryRead(
    execute: Executor,
    method: string,
    params: Record<string, unknown>,
    failures: string[]
): Promise<Record<string, unknown>[]> {
    try {
        return rowsOf(await execute(method, params));
    } catch (error) {
        logger.debug(
            'situation: %s unavailable: %s',
            method,
            error instanceof Error ? error.message : String(error)
        );
        if (!failures.includes(method)) failures.push(method);
        return [];
    }
}

/** Devices in one place fail together when the place does. */
function groupByLocation(
    devices: SituationDevice[]
): Map<number, SituationDevice[]> {
    const byLocation = new Map<number, SituationDevice[]>();
    for (const device of devices) {
        if (device.locationId === undefined) continue;
        const list = byLocation.get(device.locationId) ?? [];
        list.push(device);
        byLocation.set(device.locationId, list);
    }
    return byLocation;
}

function readDevices(rows: Record<string, unknown>[]): SituationDevice[] {
    return rows
        .map((row) => {
            // The name is on `info`, not top level. A raw id is not an answer.
            const info = (row.info ?? {}) as Record<string, unknown>;
            const locationId = Number(row.locationId);
            return {
                externalId: String(row.shellyID ?? ''),
                name: optionalString(info.name) ?? optionalString(row.name),
                ...(Number.isFinite(locationId) ? {locationId} : {}),
                presence: readPresence(row.presence)
            };
        })
        .filter((device) => device.externalId);
}

function readAlerts(rows: Record<string, unknown>[]): SituationAlert[] {
    return rows.map((row) => {
        const source = (row.source ?? {}) as Record<string, unknown>;
        const id = Number(row.id);
        return {
            ...(Number.isFinite(id) ? {id} : {}),
            severity: optionalString(row.severity),
            title: optionalString(row.title),
            subjectId: optionalString(source.subjectId),
            ruleKind: optionalString(row.ruleKind)
        };
    });
}

// The API takes one state per call and has no "open" state. Ask for each state
// that still wants a person, then dedupe by id.
async function readOpenAlerts(
    execute: Executor,
    limit: number,
    failures: string[]
): Promise<SituationAlert[]> {
    const perState = await Promise.all(
        ALERT_STATES_NEEDING_ATTENTION.map((state) =>
            tryRead(execute, 'alert.Instance.List', {limit, state}, failures)
        )
    );
    const seen = new Set<number>();
    return readAlerts(perState.flat()).filter((alert) => {
        if (alert.id === undefined) return true;
        if (seen.has(alert.id)) return false;
        seen.add(alert.id);
        return true;
    });
}

function siteConcerns(
    offline: SituationDevice[],
    online: SituationDevice[],
    locationNames: Map<number, string>
): {concerns: Concern[]; accountedFor: Set<string>} {
    // A site is down when everything in it is. Anything still talking means the
    // site has power and those devices have their own problems.
    const stillUp = new Set(
        online
            .map((device) => device.locationId)
            .filter((id): id is number => id !== undefined)
    );
    const concerns: Concern[] = [];
    const accountedFor = new Set<string>();
    for (const [locationId, behind] of groupByLocation(offline)) {
        // One device failing is not evidence about the site.
        if (stillUp.has(locationId) || behind.length < 2) continue;
        for (const device of behind) accountedFor.add(device.externalId);
        const place = locationNames.get(locationId) ?? `location ${locationId}`;
        concerns.push({
            kind: 'site_down',
            severity: 'critical',
            headline: `${behind.length} devices are offline and every one of them is at ${place}, with nothing there still reporting. Check the site before the devices.`,
            evidence: behind
                .slice(0, 8)
                .map((device) => device.name || device.externalId),
            deviceIds: behind.map((device) => device.externalId)
        });
    }
    return {concerns, accountedFor};
}

export async function readSituation(
    execute: Executor,
    options: {limit?: number} = {}
): Promise<Situation> {
    const limit = options.limit ?? 500;
    const couldNotCheck: string[] = [];

    const [deviceRows, locationRows, alerts] = await Promise.all([
        tryRead(execute, 'device.List', {limit}, couldNotCheck),
        // Best effort. Without it the headline says "location 7", not "Store 12".
        tryRead(execute, 'location.List', {limit}, []),
        readOpenAlerts(execute, limit, couldNotCheck)
    ]);

    const devices = readDevices(deviceRows);
    const locationNames = new Map<number, string>();
    for (const row of locationRows) {
        const id = Number(row.id);
        const name = optionalString(row.name);
        if (Number.isFinite(id) && name) locationNames.set(id, name);
    }

    const offline = devices.filter(isOffline);
    const online = devices.filter((device) => !isOffline(device));
    const {concerns, accountedFor} = siteConcerns(
        offline,
        online,
        locationNames
    );

    // Whatever is offline for its own reasons.
    const scattered = offline.filter(
        (device) => !accountedFor.has(device.externalId)
    );
    if (scattered.length > 0) {
        concerns.push({
            kind: 'devices_offline',
            severity: scattered.length > 5 ? 'warning' : 'info',
            headline: `${scattered.length} device${scattered.length === 1 ? ' is' : 's are'} offline, in different places.`,
            evidence: scattered
                .slice(0, 8)
                .map((device) => device.name || device.externalId),
            deviceIds: scattered.map((device) => device.externalId)
        });
    }

    if (alerts.length > 0) {
        const critical = alerts.filter(
            (alert) => (alert.severity ?? '').toLowerCase() === 'critical'
        );
        concerns.push({
            kind: 'alerts_open',
            severity: critical.length > 0 ? 'critical' : 'warning',
            headline: `${alerts.length} open alert${alerts.length === 1 ? '' : 's'}${critical.length > 0 ? `, ${critical.length} critical` : ''}.`,
            evidence: alerts
                .slice(0, 8)
                .map(
                    (alert) =>
                        alert.title || alert.ruleKind || String(alert.id ?? '?')
                ),
            deviceIds: alerts
                .map((alert) => alert.subjectId ?? '')
                .filter((id): id is string => Boolean(id))
        });
    }

    concerns.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

    return {
        concerns,
        checked: {
            devices: devices.length,
            offline: offline.length,
            openAlerts: alerts.length
        },
        // Explicit so an agent can say "nothing needs attention" instead of
        // inventing something. Only true when it saw everything.
        quiet: concerns.length === 0 && couldNotCheck.length === 0,
        ...(couldNotCheck.length > 0 ? {couldNotCheck} : {})
    };
}
