// Per-org set of what can still be open: open alert keys and pending offline
// fire jobs. Loaded once per org, then kept current by this process's writes
// and by peer alert-state signals; a key the fresh set does not hold is
// closed, so a new device costs no per-key database read.

import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {ALERT_STATES} from '../../types/api/alert';
import {BoundedMap} from '../boundedMap';
import * as PostgresProvider from '../PostgresProvider';
import {type OrgSignal, publishOrg} from '../redis/OrgSignals';
import {SingleFlight} from '../singleFlight';
import {fireAndForget} from '../util/fireAndForget';

const logger = log4js.getLogger('AlertOpenSet');

/** Above this many open keys an org keeps the per-key reads. */
export const OPEN_SET_LIMIT = 100_000;
// Peer changes since the load; past this a reload is cheaper than the reads.
const UNSURE_LIMIT = 10_000;
const LOAD_RETRY_MS = 30_000;
const OFFLINE_SIGNAL_BATCH = 500;
const RELOAD_MIN_MS = tuning.alert.stateRecheckMinMs;
const RELOAD_SPREAD_MS = tuning.alert.stateRecheckSpreadMs;
// A load can start before a just-scheduled job commits, so a schedule is kept
// apart from the loads until every set loaded before its commit has expired.
const RECENT_OFFLINE_MS = 2 * (RELOAD_MIN_MS + RELOAD_SPREAD_MS);
const RECENT_OFFLINE_MAX = 200_000;

/** Age at which known alert state is read again: bounds a missed signal.
 *  Spread so state learned together does not all go back to the database
 *  at the same moment. */
export function alertStateRecheckDelayMs(random = Math.random()): number {
    return RELOAD_MIN_MS + Math.floor(random * RELOAD_SPREAD_MS);
}

/** One alert's state key; also the alertKey of a peer signal. */
export function alertStateKey(
    organizationId: string,
    ruleId: number,
    fingerprint: string
): string {
    return JSON.stringify([organizationId, ruleId, fingerprint]);
}

export type OpenAlertLookup =
    | {kind: 'closed'}
    | {kind: 'open'; id: number; state: string}
    | {kind: 'unknown'};

const CLOSED: OpenAlertLookup = {kind: 'closed'};
const UNKNOWN: OpenAlertLookup = {kind: 'unknown'};

interface OpenRow {
    id: number;
    state: string;
}

interface OrgSnapshot {
    open: Map<string, OpenRow>;
    /** Changed by a peer since the load: only the row can answer. */
    unsure: Set<string>;
    /** Null when the job table could not be read: every pair may be pending. */
    offlineFires: Set<string> | null;
    expiresAtMs: number;
}

/** Changes seen while a load runs; the load result may predate them. */
interface RunningLoad {
    generation: number;
    pendingUnsure: Set<string>;
}

interface OrgEntry {
    snapshot?: OrgSnapshot;
    load?: RunningLoad;
    /** Bumped by every invalidation; a load started before it is dropped. */
    generation: number;
    retryAfterMs: number;
    /** Offline fire jobs scheduled here or by a peer, by job key. */
    recentOfflineFires: BoundedMap<string, true>;
}

interface SnapshotRow {
    kind?: unknown;
    rule_id?: unknown;
    key?: unknown;
    id?: unknown;
    state?: unknown;
    truncated?: unknown;
    offline_known?: unknown;
}

type LoadResult = OrgSnapshot | 'too_large';

const orgs = new BoundedMap<string, OrgEntry>({maxSize: 10_000});
const loads = new SingleFlight<string, void>('alert_open_set');
// Per (sender, org) sequence of alert-state signals, to see a missed one.
const peerSequences = new BoundedMap<string, number>({
    maxSize: 50_000,
    ttlMs: 24 * 60 * 60_000
});
const sentSequences = new Map<string, number>();
let queuedOfflineSignals = new Map<string, Set<string>>();
let offlineSignalsScheduled = false;

function entryFor(organizationId: string): OrgEntry {
    let entry = orgs.get(organizationId);
    if (!entry) {
        entry = {
            generation: 0,
            retryAfterMs: 0,
            recentOfflineFires: new BoundedMap({
                maxSize: RECENT_OFFLINE_MAX,
                ttlMs: RECENT_OFFLINE_MS
            })
        };
        orgs.set(organizationId, entry);
    }
    return entry;
}

function freshSnapshot(organizationId: string): OrgSnapshot | undefined {
    const entry = orgs.get(organizationId);
    const snapshot = entry?.snapshot;
    if (!entry || !snapshot) return undefined;
    if (snapshot.expiresAtMs > Date.now()) return snapshot;
    entry.snapshot = undefined;
    return undefined;
}

function invalidSnapshot(): Error {
    return Object.assign(new Error('Invalid alert snapshot response'), {
        code: 'ALERT_SNAPSHOT_INVALID'
    });
}

function readOpenRow(row: SnapshotRow): [number, string, OpenRow] {
    const {rule_id: ruleId, key, id, state} = row;
    if (
        typeof ruleId !== 'number' ||
        !Number.isSafeInteger(ruleId) ||
        typeof key !== 'string' ||
        typeof id !== 'number' ||
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        typeof state !== 'string' ||
        !ALERT_STATES.some((known) => known === state)
    ) {
        throw invalidSnapshot();
    }
    return [ruleId, key, {id, state}];
}

// The last row says the set is whole; without it nothing can be trusted.
function parseSnapshot(organizationId: string, rows: unknown): LoadResult {
    const list: SnapshotRow[] = Array.isArray(rows) ? rows : [];
    const summary = list.at(-1);
    if (summary?.kind !== 'snapshot') throw invalidSnapshot();
    if (summary.truncated === true) return 'too_large';
    const open = new Map<string, OpenRow>();
    const offlineFires = new Set<string>();
    for (const row of list.slice(0, -1)) {
        if (row.kind === 'open') {
            const [ruleId, fingerprint, value] = readOpenRow(row);
            open.set(alertStateKey(organizationId, ruleId, fingerprint), value);
        } else if (row.kind === 'offline_fire' && typeof row.key === 'string') {
            offlineFires.add(row.key);
        } else {
            throw invalidSnapshot();
        }
    }
    return {
        open,
        unsure: new Set(),
        offlineFires: summary.offline_known === true ? offlineFires : null,
        expiresAtMs: Date.now() + alertStateRecheckDelayMs()
    };
}

async function readSnapshot(organizationId: string): Promise<LoadResult> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_org_open_snapshot',
        {p_organization_id: organizationId, p_limit: OPEN_SET_LIMIT}
    );
    return parseSnapshot(organizationId, result?.rows);
}

function installSnapshot(
    entry: OrgEntry,
    load: RunningLoad,
    snapshot: OrgSnapshot
): void {
    for (const key of load.pendingUnsure) snapshot.unsure.add(key);
    entry.snapshot = snapshot;
}

async function loadSnapshot(organizationId: string): Promise<void> {
    const entry = entryFor(organizationId);
    const load: RunningLoad = {
        generation: entry.generation,
        pendingUnsure: new Set()
    };
    entry.load = load;
    try {
        const loaded = await readSnapshot(organizationId);
        if (entry.generation !== load.generation) return;
        if (loaded === 'too_large') {
            entry.retryAfterMs = Date.now() + alertStateRecheckDelayMs();
            logger.warn(
                'open alert set org=%s has more than %d keys; per-key reads stay',
                organizationId,
                OPEN_SET_LIMIT
            );
            return;
        }
        installSnapshot(entry, load, loaded);
    } catch (err) {
        entry.retryAfterMs = Date.now() + LOAD_RETRY_MS;
        logger.warn(
            'open alert set load failed org=%s: %s',
            organizationId,
            err instanceof Error ? err.message : String(err)
        );
    } finally {
        if (entry.load === load) entry.load = undefined;
    }
}

// Every caller waiting on a cold org shares one load. The caller reads the
// set right after, in the same turn, so no signal lands in between.
async function ensureSnapshot(organizationId: string): Promise<void> {
    if (freshSnapshot(organizationId)) return;
    if (entryFor(organizationId).retryAfterMs > Date.now()) return;
    await loads.run(organizationId, () => loadSnapshot(organizationId));
}

function answerFromSnapshot(
    scope: {organizationId: string; ruleId: number},
    fingerprint: string
): OpenAlertLookup {
    const snapshot = freshSnapshot(scope.organizationId);
    if (!snapshot) return UNKNOWN;
    const key = alertStateKey(scope.organizationId, scope.ruleId, fingerprint);
    if (snapshot.unsure.has(key)) return UNKNOWN;
    const row = snapshot.open.get(key);
    return row ? {kind: 'open', ...row} : CLOSED;
}

/** Open state from the org set, loading it first; 'unknown' means read the row. */
export async function lookupOpenAlert(
    scope: {organizationId: string; ruleId: number},
    fingerprint: string
): Promise<OpenAlertLookup> {
    await ensureSnapshot(scope.organizationId);
    return answerFromSnapshot(scope, fingerprint);
}

/** Same answer without waiting: a cold org starts its load and says 'unknown'. */
export function peekOpenAlert(
    scope: {organizationId: string; ruleId: number},
    fingerprint: string
): OpenAlertLookup {
    if (!freshSnapshot(scope.organizationId)) {
        void ensureSnapshot(scope.organizationId);
    }
    return answerFromSnapshot(scope, fingerprint);
}

/** False only when no offline fire job can be waiting under this key. */
export async function offlineFireMayBePending(
    organizationId: string,
    jobKey: string
): Promise<boolean> {
    await ensureSnapshot(organizationId);
    const offlineFires = freshSnapshot(organizationId)?.offlineFires;
    if (!offlineFires) return true;
    return (
        offlineFires.has(jobKey) ||
        entryFor(organizationId).recentOfflineFires.has(jobKey)
    );
}

function markUnsure(organizationId: string, key: string): void {
    orgs.get(organizationId)?.load?.pendingUnsure.add(key);
    const snapshot = freshSnapshot(organizationId);
    if (!snapshot) return;
    snapshot.unsure.add(key);
    if (snapshot.unsure.size > UNSURE_LIMIT)
        invalidateOpenAlertSet(organizationId);
}

/** This process committed a write that left the alert open or closed. */
export function noteAlertState(
    scope: {organizationId: string; ruleId: number; fingerprint: string},
    open: OpenRow | null
): void {
    const {organizationId, ruleId, fingerprint} = scope;
    const key = alertStateKey(organizationId, ruleId, fingerprint);
    // A running load may hold an older row for this key.
    orgs.get(organizationId)?.load?.pendingUnsure.add(key);
    const snapshot = freshSnapshot(organizationId);
    if (!snapshot) return;
    if (open) snapshot.open.set(key, {id: open.id, state: open.state});
    else snapshot.open.delete(key);
}

function addOfflineFire(organizationId: string, jobKey: string): void {
    entryFor(organizationId).recentOfflineFires.set(jobKey, true);
}

/** Call before an offline fire job is added, so a cancel never misses it. */
export function noteOfflineFireScheduled(
    organizationId: string,
    jobKey: string
): void {
    addOfflineFire(organizationId, jobKey);
    const queued = queuedOfflineSignals.get(organizationId) ?? new Set();
    queued.add(jobKey);
    queuedOfflineSignals.set(organizationId, queued);
    if (offlineSignalsScheduled) return;
    offlineSignalsScheduled = true;
    setImmediate(sendQueuedOfflineSignals);
}

function sendQueuedOfflineSignals(): void {
    offlineSignalsScheduled = false;
    const queued = queuedOfflineSignals;
    queuedOfflineSignals = new Map();
    for (const [organizationId, keys] of queued) {
        const all = [...keys];
        for (let i = 0; i < all.length; i += OFFLINE_SIGNAL_BATCH) {
            publishAlertStateChange(organizationId, {
                offlineFireKeys: all.slice(i, i + OFFLINE_SIGNAL_BATCH)
            });
        }
    }
}

/** Tell peers; no alertKey and no offline keys means "drop the whole org". */
export function publishAlertStateChange(
    organizationId: string,
    change: {alertKey?: string; offlineFireKeys?: string[]} = {}
): void {
    // Taken even when the publish fails, so the peer sees the gap next time.
    const alertSeq = (sentSequences.get(organizationId) ?? 0) + 1;
    sentSequences.set(organizationId, alertSeq);
    fireAndForget('publishOrg.alert-state-changed', () =>
        publishOrg({
            kind: 'alert-state-changed',
            orgId: organizationId,
            alertSeq,
            ...change
        })
    );
}

// Redis delivers one sender's messages in order, so anything but last + 1
// means a lost signal. A sender seen first past 1 may have sent before.
function missedPeerSignal(signal: OrgSignal): boolean {
    const seq = signal.alertSeq;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
        return true;
    }
    const id = JSON.stringify([signal.instanceId, signal.orgId]);
    const last = peerSequences.get(id);
    peerSequences.set(id, Math.max(last ?? 0, seq));
    return last === undefined ? seq !== 1 : seq !== last + 1;
}

function stringList(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? value
        : undefined;
}

/** Applies a peer signal; true means drop all known state of the org. */
export function applyPeerAlertSignal(signal: OrgSignal): boolean {
    if (signal.kind !== 'alert-state-changed') return false;
    const organizationId = signal.orgId;
    const offlineFireKeys = stringList(signal.offlineFireKeys);
    const named =
        typeof signal.alertKey === 'string' || offlineFireKeys !== undefined;
    const resync = missedPeerSignal(signal) || !named;
    if (resync) invalidateOpenAlertSet(organizationId);
    if (typeof signal.alertKey === 'string') {
        markUnsure(organizationId, signal.alertKey);
    }
    for (const key of offlineFireKeys ?? [])
        addOfflineFire(organizationId, key);
    return resync;
}

/** Drop the org set; the next lookup loads it once. */
export function invalidateOpenAlertSet(organizationId?: string): void {
    const targets =
        organizationId === undefined ? [...orgs.keys()] : [organizationId];
    for (const org of targets) {
        const entry = orgs.get(org);
        if (!entry) continue;
        entry.generation += 1;
        entry.snapshot = undefined;
        entry.retryAfterMs = 0;
        loads.forget(org);
    }
}

/** Forget every org set and peer sequence (engine stop). */
export function clearOpenAlertSet(): void {
    orgs.clear();
    peerSequences.clear();
    sentSequences.clear();
    queuedOfflineSignals = new Map();
}
