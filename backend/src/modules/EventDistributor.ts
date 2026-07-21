import {getLogger} from 'log4js';
import {tuning} from '../config';
import type AbstractDevice from '../model/AbstractDevice';
import type CommandSender from '../model/CommandSender';
import type {event_data_t, json_rpc_event} from '../types';
import {scheduleOrganizationRuleEvaluation} from './alert/evaluationPort';
import {canCrossOrganizationBoundary} from './authz/crossOrg';
import {invalidateAuthzTenant} from './authz/invalidation';
import {BoundedMap} from './boundedMap';
import {recordEvent as recordDeviceEvent} from './device/AnomalyMetric';
import {
    invalidateGroupCache as bumpLegacyGroupVersion,
    getGroupVersion,
    getGroupVersionOrgCount
} from './groupVersion';
import * as Observability from './Observability';
import * as postgres from './PostgresProvider';
import {
    hasPluginMetadataHandlers,
    notifyPluginEvent,
    sendPluginMetadata
} from './plugins/pluginEventPort';
import {onAnyOrg, publishOrg} from './redis/OrgSignals';
import {RollingMaxWindow} from './rollingMaxWindow';
import {fireAndForget} from './util/fireAndForget';
import {formatError} from './util/formatError';

// Bump legacy group version + fire authz cache invalidation + broadcast to peers.
export function invalidateGroupCache(orgId: string): void {
    bumpLegacyGroupVersion(orgId);
    fireAndForget('invalidateAuthzTenant.local', invalidateAuthzTenant(orgId));
    fireAndForget(
        'alert.scopeChanged.local',
        Promise.resolve(
            scheduleOrganizationRuleEvaluation({
                organizationId: orgId,
                reason: 'scope_changed'
            })
        )
    );
    fireAndForget(
        'publishOrg.groups-bumped',
        publishOrg({kind: 'groups-bumped', orgId})
    );
}

// Receive group-bump signals from peer instances and apply locally.
// Self-instance publishes are filtered out by OrgSignals.
export async function subscribeToOrgSignals(): Promise<void> {
    await onAnyOrg((signal) => {
        if (signal.kind === 'groups-bumped') {
            // bumpLegacyGroupVersion is a counter increment that drives
            // device-membership cache invalidation — only meaningful when
            // this instance has local devices for the org.
            if (hasLocalOrgPresence(signal.orgId)) {
                bumpLegacyGroupVersion(signal.orgId);
            }
            // invalidateAuthzTenant clears the per-tenant authz shape
            // cache — every logged-in CommandSender for that org reads
            // from it, regardless of whether their devices live here.
            // Always fire so peer access decisions don't go stale.
            fireAndForget(
                'invalidateAuthzTenant.peer',
                invalidateAuthzTenant(signal.orgId)
            );
            fireAndForget(
                'alert.scopeChanged.peer',
                Promise.resolve(
                    scheduleOrganizationRuleEvaluation({
                        organizationId: signal.orgId,
                        reason: 'scope_changed'
                    })
                )
            );
        }
    });
}

export {getGroupVersion};

type split_rule_t = [string, string]; // [core, component]
type options_t = {
    allow: split_rule_t[];
    deny: split_rule_t[];
    shellyIDs: Set<string>;
    /** Subscriber-declared dot-paths. Undefined = no filter (today's
     *  behavior). Empty array means the caller declared a filter that
     *  matches nothing; we still treat that as "no filter" so a typo
     *  doesn't silently mute a dashboard. */
    paths?: string[];
};

let next_callback_id = 1;
const callback_ids = new Map<
    number,
    [CommandSender, options_t, event_callback_t]
>();
const event_map = new Map<string, number[]>(); // < EventName, Array of callback ids>
const sender_callbacks = new Map<CommandSender, Set<number>>(); // inverse index for fast removeAllForSender

// Reverse path index. For each (eventName, declared-path top-level)
// we maintain the set of callback IDs that registered an interest. On
// dispatch with field-level changedPaths we hit this index instead of
// scanning every listener for the event. Falls back to the full list
// when an event fires without changedPaths (events that aren't
// device-status, plus removeComponent's whole-key emissions).
//
// Keyed by top-level (everything before the first '.') because path
// matching is anchored at the component layer in practice — declared
// paths look like "switch:0", "switch:0.output", "em:0.apower", etc.
const path_index = new Map<string, Map<string, Set<callback_id>>>();
const unfiltered_listeners = new Map<string, Set<callback_id>>();

function pathTopLevel(path: string): string {
    const dot = path.indexOf('.');
    return dot === -1 ? path : path.slice(0, dot);
}

function indexAdd(
    eventName: string,
    id: callback_id,
    paths: string[] | undefined
) {
    if (!paths) {
        let s = unfiltered_listeners.get(eventName);
        if (!s) {
            s = new Set();
            unfiltered_listeners.set(eventName, s);
        }
        s.add(id);
        return;
    }
    let perEvent = path_index.get(eventName);
    if (!perEvent) {
        perEvent = new Map();
        path_index.set(eventName, perEvent);
    }
    for (const p of paths) {
        const top = pathTopLevel(p);
        let s = perEvent.get(top);
        if (!s) {
            s = new Set();
            perEvent.set(top, s);
        }
        s.add(id);
    }
}

function indexRemove(
    eventName: string,
    id: callback_id,
    paths: string[] | undefined
) {
    if (!paths) {
        const s = unfiltered_listeners.get(eventName);
        if (s) {
            s.delete(id);
            if (s.size === 0) unfiltered_listeners.delete(eventName);
        }
        return;
    }
    const perEvent = path_index.get(eventName);
    if (!perEvent) return;
    for (const p of paths) {
        const top = pathTopLevel(p);
        const s = perEvent.get(top);
        if (!s) continue;
        s.delete(id);
        if (s.size === 0) perEvent.delete(top);
    }
    if (perEvent.size === 0) path_index.delete(eventName);
}

/** Build the candidate callback-id set for an event with field-level
 *  changedPaths. Returns the union of:
 *    - every unfiltered listener for the event (no paths declared), and
 *    - every path-filtered listener whose declared top-level intersects
 *      a changed path's top-level (or vice-versa for prefix matches).
 *  The per-candidate exact intersection check still runs in dispatch
 *  via pathsIntersectChanges; this index only narrows the candidate
 *  set so the inner loop iterates O(matching) instead of O(all). */
function candidatesForEvent(
    eventName: string,
    changedPaths: readonly string[]
): ReadonlySet<callback_id> {
    const perEvent = path_index.get(eventName);
    const unfiltered = unfiltered_listeners.get(eventName);
    if (!perEvent && !unfiltered) return EMPTY_CALLBACK_SET;
    // Snapshot — callbacks may call removeEventListener mid-dispatch, which
    // would corrupt the iteration if we returned the live unfiltered Set.
    const set = new Set<callback_id>();
    if (unfiltered) for (const id of unfiltered) set.add(id);
    if (perEvent) {
        // Collect candidates whose declared top-level matches a changed
        // top-level, OR (rare) whose declared top-level is a strict
        // suffix-extension of a changed top-level — both directions
        // because the existing prefix shorthand allows declared
        // "switch:0" matching changed "switch:0.output" AND declared
        // "switch:0.output" matching changed whole-key "switch:0".
        const changedTops = new Set<string>();
        for (const c of changedPaths) changedTops.add(pathTopLevel(c));
        for (const top of changedTops) {
            const s = perEvent.get(top);
            if (s) for (const id of s) set.add(id);
        }
    }
    return set;
}

const EMPTY_CALLBACK_SET: ReadonlySet<callback_id> = new Set();
/**
 * Type Aliases:
 * Aliasing doesn’t actually create a new type - it creates a new name to refer to that type.
 * Aliasing a primitive is not terribly useful, though it can be used as a form of documentation.
 */
type callback_id = number; // type alias
type event_callback_t = <T extends json_rpc_event>(
    event: T,
    eventData: event_data_t
) => void;

const logger = getLogger('event-model');

// Rolling-window peaks (idempotent peek) so /health/full + GetTopology
// don't fight over reset-on-read state.
const BROADCAST_PEAK_WINDOW_MS = 60_000;
const broadcastMs = new RollingMaxWindow(BROADCAST_PEAK_WINDOW_MS);
const serializeMs = new RollingMaxWindow(BROADCAST_PEAK_WINDOW_MS);
let broadcastLastMs = 0;
let lastSerializeMs = 0;

// shellyID → orgId map, populated at startup + on WaitingRoom approve.
// Keeps generateMetadata off the hot path DB lookup for the owning org.
const deviceOrgByShellyId = new Map<string, string>();
// Reverse index: orgId → count of local devices. Used by OrgSignals
// receive-side to skip cache-bumps for orgs with no local presence —
// stops cross-org signals from spending IO on this instance.
const localOrgRefCount = new Map<string, number>();

function incLocalOrg(orgId: string): void {
    localOrgRefCount.set(orgId, (localOrgRefCount.get(orgId) ?? 0) + 1);
}

function decLocalOrg(orgId: string): void {
    const n = (localOrgRefCount.get(orgId) ?? 0) - 1;
    if (n <= 0) localOrgRefCount.delete(orgId);
    else localOrgRefCount.set(orgId, n);
}

export function hasLocalOrgPresence(orgId: string): boolean {
    return localOrgRefCount.has(orgId);
}

export async function loadDeviceOrgMap(): Promise<void> {
    const rows = await postgres.listDeviceOrganizationPairs();
    deviceOrgByShellyId.clear();
    localOrgRefCount.clear();
    for (const r of rows) {
        if (r.external_id && r.organization_id) {
            deviceOrgByShellyId.set(r.external_id, r.organization_id);
            incLocalOrg(r.organization_id);
        }
    }
    logger.info('loaded device→org map: %d entries', deviceOrgByShellyId.size);
}

export function setDeviceOrg(shellyId: string, organizationId: string): void {
    const prev = deviceOrgByShellyId.get(shellyId);
    if (prev === organizationId) return;
    if (prev) decLocalOrg(prev);
    deviceOrgByShellyId.set(shellyId, organizationId);
    incLocalOrg(organizationId);
}

export function clearDeviceOrg(shellyId: string): void {
    deviceGroupsCache.delete(shellyId); // else a re-admit could read old groups
    const prev = deviceOrgByShellyId.get(shellyId);
    if (!prev) return;
    deviceOrgByShellyId.delete(shellyId);
    decLocalOrg(prev);
}

export function getDeviceOrg(shellyId: string): string | undefined {
    return deviceOrgByShellyId.get(shellyId);
}

// shellyID → groups. orgId+version both gate validity so a device moved to
// another org can't read the old org's groups. Size: FM_DEVICE_GROUPS_CACHE_MAX.
interface DeviceGroupsCacheEntry {
    orgId: string;
    orgVersion: number;
    groups: Array<{id: number; name: string}>;
}
const deviceGroupsCache = new BoundedMap<string, DeviceGroupsCacheEntry>({
    maxSize: tuning.device.groupsCacheMax
});

function splitRule(rule: string): split_rule_t {
    const idx = rule.indexOf(':');
    if (idx === -1) return [rule, '*'];
    return [rule.substring(0, idx), rule.substring(idx + 1)];
}

function splitRules(rules: string[] | undefined): split_rule_t[] {
    if (!rules || !Array.isArray(rules)) return [];
    return rules.map(splitRule);
}

export function addEventListener(
    sender: CommandSender,
    eventName: string,
    options: {
        allow?: string[];
        deny?: string[];
        shellyIDs?: string[];
        paths?: string[];
    },
    cb: event_callback_t
): callback_id {
    const callback_id = next_callback_id;
    // Pre-split rules once at subscribe time (avoids string splits on every event)
    const preSplit: options_t = {
        allow: splitRules(options?.allow),
        deny: splitRules(options?.deny),
        shellyIDs: new Set(options?.shellyIDs || []),
        paths:
            Array.isArray(options?.paths) && options.paths.length > 0
                ? options.paths
                : undefined
    };
    callback_ids.set(callback_id, [sender, preSplit, cb]);
    const listeners = event_map.get(eventName) || [];
    listeners.push(callback_id);
    event_map.set(eventName, listeners);
    // Reverse path index — narrows dispatch to candidates whose
    // declared top-level matches a changed top-level (O(matching)
    // instead of O(all listeners)).
    indexAdd(eventName, callback_id, preSplit.paths);
    // Track sender → callback_id for fast removeAllForSender
    let senderSet = sender_callbacks.get(sender);
    if (!senderSet) {
        senderSet = new Set();
        sender_callbacks.set(sender, senderSet);
    }
    senderSet.add(callback_id);
    next_callback_id++;
    return callback_id;
}

export function removeEventListener(
    callback_id: callback_id,
    eventName: string
) {
    const bundle = callback_ids.get(callback_id);
    let pathsToUnindex: string[] | undefined;
    if (bundle) {
        const [sender, options] = bundle;
        pathsToUnindex = options.paths;
        callback_ids.delete(callback_id);
        const senderSet = sender_callbacks.get(sender);
        if (senderSet) {
            senderSet.delete(callback_id);
            if (senderSet.size === 0) sender_callbacks.delete(sender);
        }
    }
    // If eventName is known, remove from that specific list
    if (eventName && event_map.has(eventName)) {
        const listeners = event_map.get(eventName)!;
        const index = listeners.indexOf(callback_id);
        if (index > -1) listeners.splice(index, 1);
        if (listeners.length === 0) event_map.delete(eventName);
        indexRemove(eventName, callback_id, pathsToUnindex);
        return;
    }
    // If eventName is empty/unknown, scan all events to find and remove the ID
    for (const [name, listeners] of event_map) {
        const index = listeners.indexOf(callback_id);
        if (index > -1) {
            listeners.splice(index, 1);
            if (listeners.length === 0) event_map.delete(name);
            indexRemove(name, callback_id, pathsToUnindex);
            return;
        }
    }
}

export function removeAllForSender(sender: CommandSender) {
    const senderSet = sender_callbacks.get(sender);
    if (!senderSet || senderSet.size === 0) {
        sender_callbacks.delete(sender);
        return;
    }
    // Snapshot each id's paths BEFORE deleting from callback_ids so we
    // can clean up the reverse index for every event the listener
    // touches below.
    const pathsById = new Map<callback_id, string[] | undefined>();
    for (const id of senderSet) {
        const bundle = callback_ids.get(id);
        if (bundle) pathsById.set(id, bundle[1].paths);
        callback_ids.delete(id);
    }
    for (const [eventName, listenerIds] of event_map) {
        const remaining = listenerIds.filter((id) => !senderSet.has(id));
        // Drop reverse-index entries for the listeners we just removed
        // from this event.
        for (const id of listenerIds) {
            if (senderSet.has(id)) {
                indexRemove(eventName, id, pathsById.get(id));
            }
        }
        if (remaining.length === 0) {
            event_map.delete(eventName);
        } else {
            event_map.set(eventName, remaining);
        }
    }
    sender_callbacks.delete(sender);
}

export async function processAndNotifyAll(
    event: json_rpc_event,
    eventData: event_data_t = {}
) {
    const device = eventData?.device;

    // just send non-device events
    if (!device) {
        return await notifyAll(event, eventData);
    }

    // Per-device anomaly tracking — flags chatty devices without dropping data.
    if (device.shellyID) {
        recordDeviceEvent(device.shellyID);
    }

    // Skip expensive metadata generation if no listeners
    // (plugins still get notified via notifyAll → PluginNotifier.notifyEvent)
    if (!event_map.has(event.method)) {
        return await notifyAll(event, eventData);
    }

    // send to metadata preprocessor
    try {
        // Copy rather than mutate the caller-shared input event.
        const metadata = await generateMetadata(eventData.device!);
        const outgoing: json_rpc_event = {
            ...event,
            params: {...event.params, metadata}
        };
        // Only send to plugin workers if any plugin has metadata handlers.
        if (hasPluginMetadataHandlers()) {
            const new_event = await sendPluginMetadata(outgoing, eventData);
            return await notifyAll(new_event, eventData);
        }
        return await notifyAll(outgoing, eventData);
    } catch (err) {
        logger.error('failed to generate metadata err:[%s]', formatError(err));
        return await notifyAll(event, eventData);
    }
}

async function generateMetadata(device: AbstractDevice) {
    const shellyID = device.shellyID;
    const orgId = deviceOrgByShellyId.get(shellyID);
    if (!orgId) {
        return {...device.meta, groups: []};
    }

    const currentVersion = getGroupVersion(orgId);
    const cached = deviceGroupsCache.get(shellyID);
    if (
        cached &&
        cached.orgId === orgId &&
        cached.orgVersion === currentVersion
    ) {
        return {...device.meta, groups: cached.groups};
    }

    let groups: Array<{id: number; name: string}> = [];
    let ok = false;
    try {
        const result = await postgres.callMethod(
            'organization.fn_group_find_by_member',
            {
                p_organization_id: orgId,
                p_subject_type: 'device',
                p_subject_id: shellyID
            }
        );
        groups = (result?.rows ?? []) as Array<{id: number; name: string}>;
        ok = true;
    } catch (err) {
        logger.warn('group lookup failed for %s: %s', shellyID, err);
        Observability.incrementCounter('device_groups_lookup_error');
    }
    // Never cache a failed lookup — would mask group membership until orgVersion bumps.
    if (ok) {
        deviceGroupsCache.set(shellyID, {
            orgId,
            orgVersion: currentVersion,
            groups
        });
    }
    return {...device.meta, groups};
}

// App-domain events carry organizationId so dispatch delivers only to
// senders in the same tenant. provider support and trusted senders cross orgs.

export function emitGroupCreated(id: number, name: string, orgId: string) {
    notifyAll(
        {method: 'Group.Created', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitGroupUpdated(id: number, name: string, orgId: string) {
    notifyAll(
        {method: 'Group.Updated', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitGroupDeleted(id: number, orgId: string) {
    notifyAll({method: 'Group.Deleted', params: {id}}, {organizationId: orgId});
}

export function emitGroupMembersAdded(
    id: number,
    members: Array<{subjectType: string; subjectId: string}>,
    orgId: string
) {
    if (members.length === 0) return;
    notifyAll(
        {method: 'Group.MembersAdded', params: {id, members}},
        {organizationId: orgId}
    );
}

export function emitGroupMembersRemoved(
    id: number,
    members: Array<{subjectType: string; subjectId: string}>,
    orgId: string
) {
    if (members.length === 0) return;
    notifyAll(
        {method: 'Group.MembersRemoved', params: {id, members}},
        {organizationId: orgId}
    );
}

export interface ReportAnomalyPayload {
    readonly kind:
        | 'always_on_spike'
        | 'data_quality_low'
        | 'carbon_budget_breach';
    readonly severity: 'info' | 'warning' | 'critical';
    readonly title: string;
    readonly detail: string;
    readonly value: number;
    readonly threshold: number;
    readonly dashboardId?: number;
}

// Live anomaly push. Fired when the report run detects a threshold breach.
// Clients subscribed to `Report.Anomaly` see a toast / inbox entry without
// having to re-run the report or poll.
export function emitReportAnomaly(
    orgId: string,
    anomaly: ReportAnomalyPayload
) {
    notifyAll(
        {method: 'Report.Anomaly', params: {...anomaly}},
        {organizationId: orgId}
    );
}

// Live report progress. Job state remains durable; this gives connected
// clients the same fields without waiting for the next poll.
export function emitReportProgress(
    orgId: string | null,
    payload: {
        kind: string;
        phase: string;
        jobId?: string;
        durationMs?: number;
        estimatedRows?: number;
        rowsWritten?: number;
        bytesWritten?: number;
        currentPhase?: string;
        percent?: number;
    }
) {
    // Provider-support cross-org calls drop the scope filter (empty filter
    // matches every subscriber). Tenant calls scope to organizationId.
    notifyAll(
        {method: 'Report.Progress', params: {...payload}},
        orgId ? {organizationId: orgId} : {}
    );
}

// Terminal signal for a background Report.Generate job so a polling client can
// stop polling the moment the file is ready (or failed). Carries the same
// shape Report.GetReport returns.
export function emitReportReady(
    orgId: string | null,
    payload: {
        jobId: string;
        status: 'ready' | 'failed' | 'cancelled';
        downloadUrl?: string | null;
        htmlUrl?: string | null;
        artifacts?: {
            dataCsvGz?: string;
            summaryHtml?: string;
        } | null;
        bytes?: number | null;
        error?: string | null;
    }
) {
    notifyAll(
        {method: 'Report.Ready', params: {...payload}},
        orgId ? {organizationId: orgId} : {}
    );
}

export function emitLocationCreated(id: number, name: string, orgId: string) {
    notifyAll(
        {method: 'Location.Created', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitLocationUpdated(id: number, name: string, orgId: string) {
    notifyAll(
        {method: 'Location.Updated', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitLocationDeleted(id: number, orgId: string) {
    notifyAll(
        {method: 'Location.Deleted', params: {id}},
        {organizationId: orgId}
    );
}

// id IS the org — scope fanout to that tenant.
export function emitOrganizationProfileUpdated(id: string) {
    notifyAll(
        {method: 'Organization.ProfileUpdated', params: {id}},
        {organizationId: id}
    );
}

export function emitCertificateCreated(
    id: string,
    name: string,
    orgId: string
) {
    notifyAll(
        {method: 'Certificate.Created', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitCertificateUpdated(id: string, orgId: string) {
    notifyAll(
        {method: 'Certificate.Updated', params: {id}},
        {organizationId: orgId}
    );
}

export function emitCertificateDeleted(id: string, orgId: string) {
    notifyAll(
        {method: 'Certificate.Deleted', params: {id}},
        {organizationId: orgId}
    );
}

// Per-device: the credential list is keyed by deviceId; clients refetch that row.
export function emitCredentialChanged(deviceId: string, orgId: string) {
    notifyAll(
        {method: 'Credential.Changed', params: {deviceId}},
        {organizationId: orgId}
    );
}

export function emitPersonaCreated(id: string, name: string, orgId: string) {
    notifyAll(
        {method: 'Persona.Created', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitPersonaUpdated(id: string, name: string, orgId: string) {
    notifyAll(
        {method: 'Persona.Updated', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitPersonaDeleted(id: string, orgId: string) {
    notifyAll(
        {method: 'Persona.Deleted', params: {id}},
        {organizationId: orgId}
    );
}

export function emitUserGroupCreated(id: string, name: string, orgId: string) {
    notifyAll(
        {method: 'UserGroup.Created', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitUserGroupUpdated(id: string, name: string, orgId: string) {
    notifyAll(
        {method: 'UserGroup.Updated', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitUserGroupDeleted(id: string, orgId: string) {
    notifyAll(
        {method: 'UserGroup.Deleted', params: {id}},
        {organizationId: orgId}
    );
}

export function emitUserGroupMembersAdded(
    id: string,
    userIds: string[],
    orgId: string
) {
    if (userIds.length === 0) return;
    notifyAll(
        {method: 'UserGroup.MembersAdded', params: {id, userIds}},
        {organizationId: orgId}
    );
}

export function emitUserGroupMembersRemoved(
    id: string,
    userIds: string[],
    orgId: string
) {
    if (userIds.length === 0) return;
    notifyAll(
        {method: 'UserGroup.MembersRemoved', params: {id, userIds}},
        {organizationId: orgId}
    );
}

export function emitUserCreated(userId: string, orgId: string) {
    notifyAll(
        {method: 'User.Created', params: {userId}},
        {organizationId: orgId}
    );
}

export function emitUserUpdated(userId: string, orgId: string) {
    notifyAll(
        {method: 'User.Updated', params: {userId}},
        {organizationId: orgId}
    );
}

export function emitUserDeleted(userId: string, orgId: string) {
    notifyAll(
        {method: 'User.Deleted', params: {userId}},
        {organizationId: orgId}
    );
}

export type DeviceInventorySource = 'physical' | 'virtual' | 'bluetooth';
type DeviceInventoryMethod =
    | 'Device.Created'
    | 'Device.Updated'
    | 'Device.Deleted';

export interface DeviceInventoryEventInput {
    externalId: string;
    source: DeviceInventorySource;
    orgId: string;
}

export interface DeviceRelationshipChangedInput {
    externalId?: string;
    orgId: string;
    reason: string;
}

// Bumps on any BLU inventory change so device.list can bust its BLU cache at
// once, instead of after a blind TTL.
let bluetoothInventoryVersion = 0;
export function getBluetoothInventoryVersion(): number {
    return bluetoothInventoryVersion;
}

export function emitDeviceCreated(input: DeviceInventoryEventInput): void {
    setDeviceOrg(input.externalId, input.orgId);
    emitDeviceInventoryEvent('Device.Created', input);
}

export function emitDeviceUpdated(input: DeviceInventoryEventInput): void {
    emitDeviceInventoryEvent('Device.Updated', input);
}

export function emitDeviceDeleted(input: DeviceInventoryEventInput): void {
    clearDeviceOrg(input.externalId);
    emitDeviceInventoryEvent('Device.Deleted', input);
}

function emitDeviceInventoryEvent(
    method: DeviceInventoryMethod,
    input: DeviceInventoryEventInput
): void {
    if (input.source === 'bluetooth') bluetoothInventoryVersion++;
    notifyAll(deviceInventoryEvent(method, input), deviceInventoryScope(input));
    emitDeviceRelationshipChanged({
        externalId: input.externalId,
        orgId: input.orgId,
        reason: method
    });
}

function deviceInventoryEvent(
    method: DeviceInventoryMethod,
    input: DeviceInventoryEventInput
): json_rpc_event {
    return {
        method,
        params: {externalId: input.externalId, source: input.source}
    };
}

function deviceInventoryScope(input: DeviceInventoryEventInput): event_data_t {
    return {organizationId: input.orgId};
}

export function emitDeviceRelationshipChanged(
    input: DeviceRelationshipChangedInput
): void {
    notifyAll(
        {
            method: 'Device.RelationshipsChanged',
            params: {
                reason: input.reason,
                ...(input.externalId ? {externalId: input.externalId} : {})
            }
        },
        {organizationId: input.orgId}
    );
}

export function emitDashboardCreated(id: number, name: string, orgId: string) {
    notifyAll(
        {method: 'Dashboard.Created', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitDashboardUpdated(id: number, name: string, orgId: string) {
    notifyAll(
        {method: 'Dashboard.Updated', params: {id, name}},
        {organizationId: orgId}
    );
}

export function emitDashboardDeleted(id: number, orgId: string) {
    notifyAll(
        {method: 'Dashboard.Deleted', params: {id}},
        {organizationId: orgId}
    );
}

export function emitDashboardItemsChanged(id: number, orgId: string) {
    notifyAll(
        {method: 'Dashboard.ItemsChanged', params: {id}},
        {organizationId: orgId}
    );
}

export function emitDashboardSettingsChanged(id: number, orgId: string) {
    notifyAll(
        {method: 'Dashboard.SettingsChanged', params: {id}},
        {organizationId: orgId}
    );
}

// Per-user reorder. EventDistributor filters by org only, so we include
// userId in the payload; non-actor tabs in the same org check it and
// ignore events not their own.
export function emitDashboardOrderChanged(
    userId: string,
    orgId: string,
    ids: number[]
) {
    notifyAll(
        {method: 'Dashboard.OrderChanged', params: {userId, ids}},
        {organizationId: orgId}
    );
}

export function emitLocationAssignmentSet(
    subjectType: string,
    subjectId: string,
    locationId: number,
    orgId: string
) {
    notifyAll(
        {
            method: 'Location.AssignmentSet',
            params: {subjectType, subjectId, locationId}
        },
        {organizationId: orgId}
    );
}

export function emitLocationAssignmentRemoved(
    subjectType: string,
    subjectId: string,
    locationId: number,
    orgId: string
) {
    notifyAll(
        {
            method: 'Location.AssignmentRemoved',
            params: {subjectType, subjectId, locationId}
        },
        {organizationId: orgId}
    );
}

// One aggregate event for a batch assign, so N subjects broadcast one event
// instead of N. Clients refetch the location's assignments once.
export function emitLocationAssignmentsSet(locationId: number, orgId: string) {
    notifyAll(
        {
            method: 'Location.AssignmentsSet',
            params: {locationId}
        },
        {organizationId: orgId}
    );
}

export function emitTagCreated(
    id: number,
    key: string,
    name: string,
    orgId: string
) {
    notifyAll(
        {method: 'Tag.Created', params: {id, key, name}},
        {organizationId: orgId}
    );
}

export function emitTagUpdated(
    id: number,
    key: string,
    name: string,
    orgId: string
) {
    notifyAll(
        {method: 'Tag.Updated', params: {id, key, name}},
        {organizationId: orgId}
    );
}

export function emitTagDeleted(id: number, orgId: string) {
    notifyAll({method: 'Tag.Deleted', params: {id}}, {organizationId: orgId});
}

export function emitTagAssigned(
    tagId: number,
    subjects: Array<{subjectType: string; subjectId: string}>,
    orgId: string
) {
    if (subjects.length === 0) return;
    notifyAll(
        {method: 'Tag.Assigned', params: {id: tagId, subjects}},
        {organizationId: orgId}
    );
}

export function emitTagUnassigned(
    tagId: number,
    subjects: Array<{subjectType: string; subjectId: string}>,
    orgId: string
) {
    if (subjects.length === 0) return;
    notifyAll(
        {method: 'Tag.Unassigned', params: {id: tagId, subjects}},
        {organizationId: orgId}
    );
}

// Variables are deployment-wide (no orgId). Downstream automations (Node-RED)
// listen for this event to invalidate cached action-substitution values.
export function emitVariablesChanged(key: string, operation: 'set' | 'delete') {
    notifyAll({method: 'Variables.Changed', params: {key, operation}}, {});
}

function matchesSplitRule(
    reasonCore: string,
    reasonComp: string,
    rule: split_rule_t
) {
    const ruleCore = rule[0];
    const ruleComp = rule[1];

    if (ruleCore === '*') {
        return ruleComp === '*' || reasonComp === ruleComp;
    }

    if (ruleComp === '*') {
        return reasonCore === ruleCore;
    }

    return reasonCore === ruleCore && reasonComp === ruleComp;
}

/** Compute and cache `eventData.serialized` on first call; subsequent
 *  calls return the cached string. Deferred from notifyAll (Phase 2.3
 *  follow-up): when every listener for an event declares `paths`, the
 *  full pre-serialized payload is never used and the stringify is pure
 *  waste. Path-filtered listeners build their own slim payload. */
function ensureSerialized(
    event: json_rpc_event,
    eventData: event_data_t
): string {
    if (eventData.serialized !== undefined) return eventData.serialized;
    const t0 = performance.now();
    eventData.serialized = JSON.stringify(event);
    lastSerializeMs = performance.now() - t0;
    serializeMs.record(lastSerializeMs);
    // Direct telemetry on the Phase 2.3 lazy-serialize savings:
    // every increment of this counter is a JSON.stringify that DID
    // happen because an unfiltered listener consumed the payload.
    // The complementary "saved" event is implicit — when an event
    // fans out but no listener triggers ensureSerialized, this
    // counter does not increment.
    Observability.incrementCounter('events_serialized');
    return eventData.serialized;
}

function splitEventReasons(
    reason: event_data_t['reason']
): split_rule_t[] | undefined {
    if (reason === undefined) return undefined;
    const reasonArr = Array.isArray(reason)
        ? reason
        : typeof reason === 'string'
          ? [reason]
          : [];
    return reasonArr.length > 0 ? reasonArr.map(splitRule) : undefined;
}

async function isDeviceAccessAllowed(
    sender: CommandSender,
    eventName: string,
    shellyID: string
): Promise<boolean> {
    const syncResult = sender.canAccessDeviceSync(shellyID);
    if (syncResult === false) {
        Observability.incrementCounter('events_permission_denied');
        return false;
    }
    if (syncResult === true) return true;
    try {
        const hasAccess = await sender.canAccessDevice(shellyID);
        if (!hasAccess) {
            Observability.incrementCounter('events_permission_denied');
        }
        return hasAccess;
    } catch (error) {
        logger.warn(
            'canAccessDevice threw for event [%s] device [%s] — skipping listener: %s',
            eventName,
            shellyID,
            error
        );
        return false;
    }
}

export function passesOptionFilters(
    options: options_t,
    device: AbstractDevice | undefined,
    splitReasons: split_rule_t[] | undefined
): boolean {
    if (device && options.shellyIDs.size > 0) {
        if (!options.shellyIDs.has(device.shellyID)) return false;
    }
    if (splitReasons === undefined) return true;
    const {allow, deny} = options;
    if (
        deny.length > 0 &&
        splitReasons.some(([rc, rcomp]) =>
            deny.some((rule) => matchesSplitRule(rc, rcomp, rule))
        )
    ) {
        Observability.incrementCounter('events_filtered');
        return false;
    }
    if (
        allow.length > 0 &&
        !splitReasons.some(([rc, rcomp]) =>
            allow.some((rule) => matchesSplitRule(rc, rcomp, rule))
        )
    ) {
        Observability.incrementCounter('events_filtered');
        return false;
    }
    return true;
}

/** Does any declared path intersect the field-level changed set?
 *  Declared paths match by full equality OR prefix (so "switch:0" picks
 *  up "switch:0.output", "switch:0.apower", etc). */
function pathsIntersectChanges(
    declared: readonly string[],
    changed: readonly string[]
): boolean {
    for (const c of changed) {
        for (const d of declared) {
            if (c === d || c.startsWith(`${d}.`) || d.startsWith(`${c}.`)) {
                return true;
            }
        }
    }
    return false;
}

/** Read `obj.a.b.c` for dot-path "a.b.c". Returns undefined on miss
 *  (including missing intermediate). Dots that are part of a component
 *  key (e.g. "switch:0") are preserved because we split on the first
 *  `.` only and rejoin — Shelly component keys never contain `.`. */
function readDotPath(obj: unknown, path: string): unknown {
    const segs = path.split('.');
    let cur: any = obj;
    for (const seg of segs) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[seg];
    }
    return cur;
}

/** Write `value` at `obj.a.b.c`, creating intermediate objects. */
function writeDotPath(obj: Record<string, any>, path: string, value: unknown) {
    const segs = path.split('.');
    let cur = obj;
    for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i];
        if (typeof cur[seg] !== 'object' || cur[seg] == null) cur[seg] = {};
        cur = cur[seg];
    }
    cur[segs[segs.length - 1]] = value;
}

/** Build a trimmed Shelly.Status event containing only the declared
 *  paths. Keeps `shellyID` and any metadata the dispatcher attached;
 *  rewrites `status` to a sparse object. */
function buildPathFilteredEvent(
    event: json_rpc_event,
    paths: readonly string[]
): json_rpc_event {
    const status = (event.params as {status?: unknown})?.status;
    if (status == null || typeof status !== 'object') return event;
    const slim: Record<string, any> = {};
    for (const p of paths) {
        const v = readDotPath(status, p);
        if (v !== undefined) writeDotPath(slim, p, v);
    }
    // Partial: only the subscriber's declared components, so the client must
    // merge it, not prune (which would drop everything it didn't declare).
    return {
        method: event.method,
        params: {...event.params, status: slim, partial: true}
    };
}

async function dispatchToListeners(
    event: json_rpc_event,
    eventData: event_data_t,
    splitReasons: split_rule_t[] | undefined,
    listenerIds: number[]
): Promise<number[]> {
    const eventName = event.method;
    const {device, changes} = eventData;
    const changedPaths = changes?.map((c) => c.path);

    // Liveness pass — identify which ids still have a callback bundle.
    // This is the data prune needs, independent of which listeners
    // actually fire this round. O(listenerIds), Map lookups only.
    const live: callback_id[] = [];
    for (const id of listenerIds) {
        if (callback_ids.has(id)) live.push(id);
    }

    // Dispatch pass — when changedPaths is present we hit the reverse
    // index for O(matching listeners). Otherwise iterate every live
    // listener (today's path; events without diff info, plus the legacy
    // allow/deny filter route).
    let dispatchSet: Iterable<callback_id>;
    if (changedPaths !== undefined) {
        const candidates = candidatesForEvent(eventName, changedPaths);
        // Track how much work the reverse path index saved us. Total
        // candidates iterated vs. live listeners skipped — direct
        // telemetry on the Phase 2.3 / reverse-index wins. Materialise
        // the iterable once so we can count it.
        const candidateSet =
            candidates instanceof Set ? candidates : new Set(candidates);
        Observability.incrementCounter(
            'events_path_dispatch_candidates',
            candidateSet.size
        );
        const skipped = live.length - candidateSet.size;
        if (skipped > 0) {
            Observability.incrementCounter(
                'events_path_dispatch_skipped',
                skipped
            );
        }
        dispatchSet = candidateSet;
    } else {
        dispatchSet = live;
    }

    const eventOrgId = eventData.organizationId;
    // Per-device events scope by the source device — passed either as the full
    // `device` (status/lifecycle) or as `shellyID` (entity/BTHome events that
    // don't carry the object). Without one of these the event is unscoped.
    const scopeShellyID = device?.shellyID ?? eventData.shellyID;
    for (const callback_id of dispatchSet) {
        const bundle = callback_ids.get(callback_id);
        if (!bundle) continue;
        const [sender, options, cb] = bundle;

        if (
            scopeShellyID !== undefined &&
            !(await isDeviceAccessAllowed(sender, eventName, scopeShellyID))
        ) {
            continue;
        }
        // Tenant-tagged events only fan out to same-org senders.
        if (eventOrgId !== undefined && !sender.isTrusted()) {
            if (
                !canCrossOrganizationBoundary(sender) &&
                sender.getOrganizationId() !== eventOrgId
            ) {
                continue;
            }
        }
        if (!passesOptionFilters(options, device, splitReasons)) continue;

        // Subscriber-declared dot-path filter. Skip the listener when
        // we have field-level diff info AND none of their declared
        // paths intersect what changed. When changedPaths is absent
        // (events that don't carry diff info), fall through to the
        // value extraction below so declared paths still trim payload.
        if (options.paths) {
            if (
                changedPaths !== undefined &&
                !pathsIntersectChanges(options.paths, changedPaths)
            ) {
                Observability.incrementCounter('events_path_filtered');
                continue;
            }
            if (typeof cb === 'function') {
                // Build a per-listener trimmed event. Clear `serialized`
                // so the cb's JSON.stringify falls back to the slim
                // payload instead of the full pre-serialized version.
                const trimmed = buildPathFilteredEvent(event, options.paths);
                const trimmedData: event_data_t = {
                    ...eventData,
                    serialized: undefined
                };
                cb(trimmed, trimmedData);
            }
            continue;
        }

        if (typeof cb === 'function') {
            // Trigger lazy serialize on the first unfiltered listener;
            // subsequent ones in the same event reuse the cached
            // eventData.serialized. When zero unfiltered listeners
            // survive permission + option filters, the stringify is
            // skipped entirely.
            ensureSerialized(event, eventData);
            logger.debug(
                'notifyAll - sending event:[%s] to listener:[%d]',
                eventName,
                callback_id
            );
            cb(event, eventData);
        }
    }
    return live;
}

function pruneStaleListeners(
    eventName: string,
    baseline: number[],
    active: number[]
): void {
    const current = event_map.get(eventName) ?? [];
    if (active.length >= baseline.length) return;
    const baselineSet = new Set(baseline);
    const activeSet = new Set(active);
    const remaining = current.filter(
        (id) => !baselineSet.has(id) || activeSet.has(id)
    );
    if (remaining.length === 0) {
        logger.mark('deleting event_name:[%s]', eventName);
        event_map.delete(eventName);
        return;
    }
    logger.mark(
        'removing %s listeners from event_name:[%s]',
        current.length - remaining.length,
        eventName
    );
    event_map.set(eventName, remaining);
}

function recordBroadcastTime(eventName: string, t0: number): void {
    const elapsed = performance.now() - t0;
    broadcastLastMs = elapsed;
    broadcastMs.record(elapsed);
    if (Observability.getLevel() >= 2) {
        Observability.recordRpcTiming(`event:${eventName}`, elapsed);
    }
}

export async function notifyAll(
    event: json_rpc_event,
    eventData: event_data_t
) {
    const broadcastT0 = performance.now();
    Observability.incrementCounter('events_broadcast');
    const eventName = event.method;
    if (eventName !== 'Console.Log') {
        notifyPluginEvent(event, eventData);
    }

    const listenerIds = event_map.get(eventName);
    if (!listenerIds) {
        recordBroadcastTime(eventName, broadcastT0);
        return;
    }
    const baselineListenerIds = [...listenerIds];

    // Serialization is now lazy — ensureSerialized() fires inside
    // dispatchToListeners only when an unfiltered listener actually
    // consumes the full payload. Saves a JSON.stringify per event
    // when every listener has declared `paths` and only consumes
    // its own slim trimmed payload.
    const splitReasons = splitEventReasons(eventData.reason);
    const active = await dispatchToListeners(
        event,
        eventData,
        splitReasons,
        baselineListenerIds
    );
    pruneStaleListeners(eventName, baselineListenerIds, active);
    recordBroadcastTime(eventName, broadcastT0);
}

Observability.registerModule('events', {
    stats: () => ({
        listeners: callback_ids.size,
        eventTypes: event_map.size,
        groupVersionOrgs: getGroupVersionOrgCount(),
        deviceOrgMapSize: deviceOrgByShellyId.size,
        deviceGroupsCacheSize: deviceGroupsCache.size,
        broadcastMaxMs: broadcastMs.peak(),
        broadcastLastMs,
        lastSerializeMs,
        serializeMaxMs: serializeMs.peak()
    }),
    topology: {
        role: 'transform',
        cluster: 'pipeline',
        upstreams: ['registry', 'shellyEvents'],
        downstreams: ['plugins', 'pluginWorkers'],
        label: 'Events',
        description: 'Event broadcast distributor',
        route: '/monitoring/events'
    }
});
