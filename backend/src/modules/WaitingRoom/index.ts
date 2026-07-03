import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as DeviceCollector from '../DeviceCollector';
import {
    invalidateAccessControl,
    readAccessControlCached
} from '../deviceIngress/deviceTrustCache';
import {ingressStage} from '../deviceIngress/ingressTrace';
import {
    finalizePendingAdmission as defaultFinalize,
    reservePendingAdmission as defaultReserve
} from '../discovery/pendingAdmissionRepo';
import * as Observability from '../Observability';
import * as postgres from '../PostgresProvider';
import {withPostgresTransaction} from '../postgresTx';
import type {WaitingEntry} from '../redis/ports';
import {TimeoutError, withTimeout} from '../util/withTimeout';
import {BoundedPendingMap} from './BoundedPendingMap';
import {gatelessDeviceOrg, operatorOwnsGatelessOrg} from './defaultOrg';
import {ReconnectLimiter} from './ReconnectLimiter';
import {
    claimPending,
    dropPending,
    listPending,
    markRejected,
    restoreClaimedPending
} from './redisWaitingStore';
import {sanitizePendingPayload} from './sanitize';
import type {
    AddDeviceInput,
    AdmissionIntent,
    ApproveCallback,
    PendingEntry
} from './types';

export type {AdmissionIntent} from './types';

const logger = getLogger('WaitingRoom');

// Reserve peeks; finalize consumes — split so approve can run between.
export interface AutoAdmitSeam {
    reserve: (shellyID: string) => Promise<AdmissionIntent | null>;
    finalize: (shellyID: string, organizationId: string) => Promise<boolean>;
}
let autoAdmitSeam: AutoAdmitSeam | null = null;

// Test-only override. Returns a restore handle the caller MUST invoke
// (afterEach). A second install with the first unrestored throws so a
// leaking suite fails loudly instead of bleeding into the next test.
// Tokens make the restore handle single-use and ownership-checked: a
// stale handle called after a newer install is a silent no-op instead
// of clobbering the live seam back to the previous tester's state.
export type RestoreSeam = () => void;

let activeAutoAdmitToken: symbol | null = null;
export function __setAutoAdmitSeamForTests(seam: AutoAdmitSeam): RestoreSeam {
    assertNoActiveAutoAdmitSeam();
    const myToken = Symbol('autoAdmitSeam');
    activeAutoAdmitToken = myToken;
    autoAdmitSeam = seam;
    return makeSingleUseRestore(() => {
        if (activeAutoAdmitToken !== myToken) return;
        autoAdmitSeam = null;
        activeAutoAdmitToken = null;
    });
}

function assertNoActiveAutoAdmitSeam(): void {
    if (autoAdmitSeam) {
        throw new Error(
            'WaitingRoom auto-admit seam already installed — previous test forgot its restore handle'
        );
    }
}

// Wraps a revert so a second call is a no-op. Pairs with the token
// guard: token check protects against stale-after-install; this flag
// protects against double-restore in the same test.
function makeSingleUseRestore(revert: () => void): RestoreSeam {
    let consumed = false;
    return () => {
        if (consumed) return;
        consumed = true;
        revert();
    };
}

function getAutoAdmitSeam(): AutoAdmitSeam {
    if (autoAdmitSeam) return autoAdmitSeam;
    return {
        reserve: async (shellyID) => {
            const row = await defaultReserve(
                shellyID,
                tuning.ws.admissionReserveGraceSeconds
            );
            if (!row) return null;
            return {
                organization_id: row.organization_id,
                group_id: row.group_id
            };
        },
        finalize: defaultFinalize
    };
}

// Bind runs BEFORE approve so Shelly.Connect observes the org link;
// audit runs AFTER the intent row is consumed.
export interface AutoAdmitHooks {
    preApproveBind: (
        shellyID: string,
        intent: AdmissionIntent
    ) => Promise<boolean>;
    postFinalizeAudit: (shellyID: string, intent: AdmissionIntent) => void;
}
let autoAdmitHooks: AutoAdmitHooks | null = null;
export function setAutoAdmitHooks(hooks: AutoAdmitHooks | null): void {
    autoAdmitHooks = hooks;
}

async function tryAutoAdmit(
    shellyID: string,
    onApprove: ApproveCallback
): Promise<boolean> {
    const intent = await reserveIntentSafe(shellyID);
    if (!intent) return false;
    logger.info(
        'auto-admit shellyID=%s org=%s (Discovery intent)',
        shellyID,
        intent.organization_id
    );
    const bound = await runPreApproveBindSafe(shellyID, intent);
    if (!bound) return false;
    const approveOk = await runApproveSafe(shellyID, onApprove, intent);
    if (!approveOk) return false;
    const consumed = await finalizeIntentSafe(shellyID, intent);
    if (!consumed) return false;
    runPostFinalizeAuditSafe(shellyID, intent);
    return true;
}

async function reserveIntentSafe(
    shellyID: string
): Promise<AdmissionIntent | null> {
    try {
        return await getAutoAdmitSeam().reserve(shellyID);
    } catch (err) {
        logger.warn(
            'auto-admit reserve failed for %s — falling through to queue: %s',
            shellyID,
            err
        );
        return null;
    }
}

async function runApproveSafe(
    shellyID: string,
    onApprove: ApproveCallback,
    intent: AdmissionIntent
): Promise<boolean> {
    try {
        await onApprove(intent);
        return true;
    } catch (err) {
        logger.warn(
            'auto-admit approve threw for %s — leaving intent for next reconnect: %s',
            shellyID,
            err
        );
        return false;
    }
}

// Absorbs slot-rejection rejections from non-awaited approve sites.
function fireOnApproveSafe(onApprove: ApproveCallback, shellyID: string): void {
    void Promise.resolve(onApprove()).catch((err) => {
        logger.warn('onApprove rejected for %s: %s', shellyID, err);
    });
}

async function runPreApproveBindSafe(
    shellyID: string,
    intent: AdmissionIntent
): Promise<boolean> {
    if (!autoAdmitHooks) return true;
    try {
        return await autoAdmitHooks.preApproveBind(shellyID, intent);
    } catch (err) {
        logger.warn(
            'auto-admit pre-approve bind failed for %s — leaving intent for next reconnect: %s',
            shellyID,
            err
        );
        return false;
    }
}

async function finalizeIntentSafe(
    shellyID: string,
    intent: AdmissionIntent
): Promise<boolean> {
    try {
        return await getAutoAdmitSeam().finalize(
            shellyID,
            intent.organization_id
        );
    } catch (err) {
        logger.warn(
            'auto-admit finalize failed for %s (approve already ran): %s',
            shellyID,
            err
        );
        return false;
    }
}

function runPostFinalizeAuditSafe(
    shellyID: string,
    intent: AdmissionIntent
): void {
    if (!autoAdmitHooks) return;
    try {
        autoAdmitHooks.postFinalizeAudit(shellyID, intent);
    } catch (err) {
        logger.warn('auto-admit audit hook failed for %s: %s', shellyID, err);
    }
}

export type AdmissionResult =
    | {status: 'queued'}
    | {status: 'approved'}
    | {status: 'denied'}
    | {status: 'rate_limited'; retryAfterMs: number};

type WaitingRoomStore = Pick<
    typeof postgres,
    | 'ACCESS_CONTROL'
    | 'accessControl'
    | 'admitBatch'
    | 'allowAccessControl'
    | 'denyAccessControl'
    | 'getPendingDevices'
    | 'getDeniedDevices'
    | 'store'
>;

let waitingRoomStore: WaitingRoomStore = postgres;
let waitingRoomNotifier = notifyWaitingRoomFromEvents;
// Test passthrough mirrors the real wrapper: hooks registered during the
// body fire after the (synthetic) commit; if the body throws, they don't.
const TX_PASSTHROUGH: typeof withPostgresTransaction = async (fn) => {
    const hooks: Array<() => void | Promise<void>> = [];
    const result = await fn(0, {
        txId: 0,
        onCommit: (cb) => hooks.push(cb)
    });
    for (const hook of hooks) await hook();
    return result;
};
let _waitingRoomTx: typeof withPostgresTransaction = withPostgresTransaction;

let activeStoreToken: symbol | null = null;
export function __setStoreForTests(
    overrides: Partial<WaitingRoomStore>
): RestoreSeam {
    assertNoActiveStoreOverride();
    const myToken = Symbol('storeOverride');
    activeStoreToken = myToken;
    waitingRoomStore = {...postgres, ...overrides};
    _waitingRoomTx = TX_PASSTHROUGH;
    return makeSingleUseRestore(() => {
        if (activeStoreToken !== myToken) return;
        waitingRoomStore = postgres;
        _waitingRoomTx = withPostgresTransaction;
        activeStoreToken = null;
    });
}

function assertNoActiveStoreOverride(): void {
    if (activeStoreToken !== null) {
        throw new Error(
            'WaitingRoom store override already installed — previous test forgot its restore handle'
        );
    }
}

let activeNotifierToken: symbol | null = null;
export function __setNotifierForTests(notifier: () => void): RestoreSeam {
    assertNoActiveNotifierOverride();
    const myToken = Symbol('notifierOverride');
    activeNotifierToken = myToken;
    waitingRoomNotifier = notifier;
    return makeSingleUseRestore(() => {
        if (activeNotifierToken !== myToken) return;
        waitingRoomNotifier = notifyWaitingRoomFromEvents;
        activeNotifierToken = null;
    });
}

function assertNoActiveNotifierOverride(): void {
    if (activeNotifierToken !== null) {
        throw new Error(
            'WaitingRoom notifier override already installed — previous test forgot its restore handle'
        );
    }
}

function logAudit(action: (audit: typeof import('../AuditLogger')) => void) {
    // Audit chain failures must be loud — a silent warn here means the
    // operator only finds out a row is missing during incident review.
    void import('../AuditLogger.js')
        .then(action)
        .catch((error) => logger.error('Waiting Room audit failed: %s', error));
}

function notifyWaitingRoomFromEvents() {
    // Same as logAudit: dropped notification → clients miss waiting-room
    // updates without trace. Error level so monitoring picks it up.
    void import('../ShellyEvents.js')
        .then(({notifyComponentEvent}) =>
            notifyComponentEvent('device', 'waiting_room_updated')
        )
        .catch((error) =>
            logger.error('Waiting Room notification failed: %s', error)
        );
}

// Per-process socket-callback handles only; the canonical pending list is the
// Redis store. Bounded TTL/LRU is a leak backstop for handles that never close.
const pendingDevices = new BoundedPendingMap({
    max: tuning.waitingRoom.max,
    ttlMs: tuning.waitingRoom.ttlMs,
    sweepMs: tuning.waitingRoom.sweepMs,
    onEvict: (shellyID, reason) => {
        Observability.incrementLabeledCounter('waiting_room_evicted', {
            reason
        });
        logAudit((audit) => audit.logWaitingRoomEvict(shellyID, reason));
        logger.warn(
            'Waiting Room evicted pending device shellyID=%s reason=%s pending=%d max=%d ttlMs=%d',
            shellyID,
            reason,
            pendingDevices.size(),
            tuning.waitingRoom.max,
            tuning.waitingRoom.ttlMs
        );
        debouncedNotifyWaitingRoom();
    }
});

const reconnectLimiter = new ReconnectLimiter({
    maxKeys: tuning.waitingRoom.reconnectKeyMax,
    windowMs: tuning.waitingRoom.reconnectWindowMs,
    maxPerWindow: tuning.waitingRoom.reconnectMaxPerWindow,
    blockMs: tuning.waitingRoom.reconnectBlockMs
});

// Debounce waiting_room_updated during connection storms.
let wrNotifyTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedNotifyWaitingRoom() {
    if (wrNotifyTimer) return;
    wrNotifyTimer = setTimeout(() => {
        wrNotifyTimer = null;
        waitingRoomNotifier();
    }, tuning.waitingRoom.notifyDebounceMs);
    wrNotifyTimer.unref?.();
}

export async function addDevice(
    shellyID: string,
    onApprove: ApproveCallback,
    onDeny: () => void,
    onEvict: () => void,
    onQuarantine: () => void
): Promise<AdmissionResult> {
    return addDeviceWithPolicy(
        {shellyID, onApprove, onDeny, onEvict, onQuarantine},
        {allowStoredDecision: true, allowAutoAdmit: true}
    );
}

export async function queueDevice(
    input: AddDeviceInput
): Promise<AdmissionResult> {
    return addDeviceWithPolicy(input, {
        allowStoredDecision: false,
        allowAutoAdmit: false
    });
}

interface AdmissionPolicy {
    allowStoredDecision: boolean;
    allowAutoAdmit: boolean;
}

async function addDeviceWithPolicy(
    input: AddDeviceInput,
    policy: AdmissionPolicy
): Promise<AdmissionResult> {
    if (policy.allowStoredDecision) {
        const accessControl = await readAccessControl(input.shellyID);
        const decision = await applyStoredDecision(input, accessControl);
        if (decision) return decision;
    }

    if (policy.allowAutoAdmit) {
        const autoAdmitted = await tryAutoAdmit(
            input.shellyID,
            input.onApprove
        );
        if (autoAdmitted) {
            reconnectLimiter.clear(input.shellyID);
            return {status: 'approved'};
        }
    }

    return queuePendingDevice(input);
}

function readAccessControl(shellyID: string): Promise<number> {
    return readAccessControlCached(shellyID, readAccessControlFromDb);
}

async function readAccessControlFromDb(shellyID: string): Promise<number> {
    let accessControl: number;
    try {
        const ms = tuning.waitingRoom.configTimeoutMs;
        const row =
            ms > 0
                ? await withTimeout(
                      () => waitingRoomStore.accessControl(shellyID),
                      ms,
                      'waitingRoom.accessControl'
                  )
                : await waitingRoomStore.accessControl(shellyID);
        accessControl = row?.control_access || Number.NaN;
    } catch (error) {
        if (error instanceof TimeoutError) {
            Observability.incrementCounter('waiting_room_config_timeouts');
        }
        logger.error(
            'Failed to check access control for %s: %s',
            shellyID,
            error
        );
        accessControl = Number.NaN;
    }
    return accessControl;
}

async function applyStoredDecision(
    input: AddDeviceInput,
    accessControl: number
): Promise<AdmissionResult | null> {
    if (!Number.isFinite(accessControl)) return null;

    if (accessControl === waitingRoomStore.ACCESS_CONTROL.DENIED) {
        reconnectLimiter.clear(input.shellyID);
        input.onDeny();
        return {status: 'denied'};
    }

    if (accessControl !== waitingRoomStore.ACCESS_CONTROL.ALLOWED) {
        return null;
    }

    // Stored ALLOWED means "try to admit", not "already approved". Gate every
    // attempt through the reconnect limiter first: a device whose admit keeps
    // failing (e.g. init_queue_full) gets blocked instead of hammering the init
    // gate, and only a real success is reported approved.
    const gate = reconnectLimiter.check(input.shellyID);
    if (!gate.allowed) {
        Observability.incrementCounter('waiting_room_reconnect_limited');
        logger.debug(
            'stored-approval blocked for %s — backing off %dms',
            input.shellyID,
            gate.retryAfterMs
        );
        return {status: 'rate_limited', retryAfterMs: gate.retryAfterMs};
    }

    const admitted = await runStoredApproveSafe(
        input.shellyID,
        input.onApprove
    );
    if (admitted) {
        reconnectLimiter.clear(input.shellyID);
        logger.debug('stored-approval admitted %s', input.shellyID);
        return {status: 'approved'};
    }
    return {
        status: 'rate_limited',
        retryAfterMs: tuning.waitingRoom.reconnectBlockMs
    };
}

async function runStoredApproveSafe(
    shellyID: string,
    onApprove: ApproveCallback
): Promise<boolean> {
    try {
        await onApprove();
        return true;
    } catch (err) {
        // Counter carries the volume for monitoring; the per-device detail is
        // debug so a storm does not flood the logs.
        Observability.incrementCounter('waiting_room_stored_admit_failed');
        logger.debug(
            'stored-approval admit failed for %s — backing off: %s',
            shellyID,
            err
        );
        return false;
    }
}

function queuePendingDevice(input: AddDeviceInput): AdmissionResult {
    const reconnectDecision = reconnectLimiter.check(input.shellyID);
    if (!reconnectDecision.allowed) {
        Observability.incrementCounter('waiting_room_reconnect_limited');
        logger.warn(
            'Waiting Room throttled reconnect shellyID=%s retryAfterMs=%d',
            input.shellyID,
            reconnectDecision.retryAfterMs
        );
        return {
            status: 'rate_limited',
            retryAfterMs: reconnectDecision.retryAfterMs
        };
    }

    pendingDevices.set(input.shellyID, {
        onApprove: input.onApprove,
        onDeny: input.onDeny,
        onEvict: input.onEvict,
        onQuarantine: input.onQuarantine,
        touchedAt: Date.now()
    });
    debouncedNotifyWaitingRoom();

    return {status: 'queued'};
}

export function countPendingDevices(): number {
    return pendingDevices.size();
}

export function dropPendingDevice(shellyID: string): boolean {
    const dropped = pendingDevices.delete(shellyID);
    if (dropped) debouncedNotifyWaitingRoom();
    return dropped;
}

// After a by-id decision is persisted, resolve the external device, drop its
// cached trust, and take the live local handle. Null when the row is gone.
async function takeDecidedDevice(
    id: number
): Promise<{externalId: string; device: PendingEntry | undefined} | null> {
    const dd: any = await waitingRoomStore.accessControl(undefined, id);
    if (!dd) return null;
    await invalidateAccessControl(dd.external_id);
    return {
        externalId: dd.external_id,
        device: pendingDevices.take(dd.external_id)
    };
}

export async function approveDevice(id: number, username?: string) {
    await waitingRoomStore.allowAccessControl(id);
    const taken = await takeDecidedDevice(id);
    if (!taken) return false;
    const {externalId, device} = taken;
    if (device) {
        reconnectLimiter.clear(externalId);
        fireOnApproveSafe(device.onApprove, externalId);
        Observability.incrementCounter('waiting_room_approved');
        logAudit((audit) => audit.logDeviceAdd(externalId, username));
    }
    return !!device;
}

/**
 * Batch approve: fires onApprove callbacks from pendingDevices
 * for all records. Pure in-memory: DB batch ops happen in caller.
 */
export function approveDevicesBatch(
    records: postgres.get_resp_t[],
    username?: string
) {
    for (const rec of records) {
        const device = pendingDevices.take(rec.external_id);
        if (device) {
            reconnectLimiter.clear(rec.external_id);
            fireOnApproveSafe(device.onApprove, rec.external_id);
            Observability.incrementCounter('waiting_room_approved');
            logAudit((audit) => audit.logDeviceAdd(rec.external_id, username));
        }
    }
    debouncedNotifyWaitingRoom();
}

export async function approveDevicesByExternalIds(
    externalIds: string[],
    username?: string,
    beforeApprove?: (record: postgres.get_resp_t) => Promise<void>,
    organizationId?: string
) {
    const success: string[] = [];
    const error: string[] = [];
    const records: postgres.get_resp_t[] = [];

    const {admissions, unknown} = collectAdmissionsForApprove(externalIds);
    error.push(...unknown);
    if (admissions.length === 0) {
        debouncedNotifyWaitingRoom();
        return {success, error, records};
    }

    // external_id is globally unique, so an ALLOWED flip with a null org could
    // match another org's row; refuse rather than run unscoped.
    if (!organizationId) {
        logger.error(
            'approveDevicesByExternalIds called without an organization for %d device(s) — refusing',
            admissions.length
        );
        for (const a of admissions) error.push(a.externalId);
        debouncedNotifyWaitingRoom();
        return {success, error, records};
    }

    const admittedByExtId = await runAdmissionBatch(
        admissions,
        postgres.ACCESS_CONTROL.ALLOWED,
        'approve',
        organizationId
    );
    if (!admittedByExtId) {
        for (const a of admissions) error.push(a.externalId);
        debouncedNotifyWaitingRoom();
        return {success, error, records};
    }

    for (const {externalId: shellyID} of admissions) {
        const record = admittedByExtId.get(shellyID);
        if (!record) {
            error.push(shellyID);
            continue;
        }
        Observability.incrementCounter('waiting_room_approved');
        logAudit((audit) => audit.logDeviceAdd(shellyID, username));
        success.push(shellyID);
        records.push(record);
        await invalidateAccessControl(shellyID);
        // The claim path removed the store entry; this fallback path must
        // too, or the approved device stays listed until its TTL.
        await dropStoreEntrySafe(shellyID, organizationId);
        await fireApproveSideEffects(shellyID, record, beforeApprove);
    }
    debouncedNotifyWaitingRoom();
    return {success, error, records};
}

async function dropStoreEntrySafe(
    shellyID: string,
    organizationId?: string
): Promise<void> {
    try {
        if (organizationId) {
            await onOperatorAndLegacyOrg(organizationId, shellyID, dropPending);
            return;
        }
        const defaultOrg = gatelessDeviceOrg();
        if (defaultOrg) await dropPending(defaultOrg, shellyID);
    } catch (err) {
        logger.warn(
            'Approved %s but could not drop its waiting-room entry: %s',
            shellyID,
            err
        );
    }
}

// Only devices with a live pending entry are admissible.
function collectAdmissionsForApprove(externalIds: string[]) {
    const admissions: Array<{externalId: string; jdoc: unknown}> = [];
    const unknown: string[] = [];
    for (const shellyID of externalIds) {
        const pending = pendingDevices.get(shellyID);
        if (!pending) {
            unknown.push(shellyID);
            continue;
        }
        // The map proves the device is live; its full status arrives on connect.
        admissions.push({externalId: shellyID, jdoc: {shellyID}});
    }
    return {admissions, unknown};
}

// fn_admit_batch returns every matching row, including ones it didn't flip.
// An ALLOWED admit is genuine only when control_access actually landed on
// ALLOWED; deny/quarantine apply to every returned row. Cross-org rows are
// excluded by the DB (org-scoped RETURN), not by this check.
function isGenuineAdmit(record: AdmitRecord, accessControl: number): boolean {
    if (accessControl !== postgres.ACCESS_CONTROL.ALLOWED) return true;
    return record.control_access === postgres.ACCESS_CONTROL.ALLOWED;
}

type AdmitRecord = postgres.get_resp_t;

// Persisted-row map keyed by external_id, or null on batch failure. Only
// genuinely-admitted rows are kept; cross-org / not-flipped rows drop out so
// every caller sees them as failures, never false successes.
// organizationId stamps org with ALLOWED; null for deny/quarantine.
async function runAdmissionBatch(
    admissions: Array<{externalId: string; jdoc?: unknown}>,
    accessControl:
        | typeof postgres.ACCESS_CONTROL.ALLOWED
        | typeof postgres.ACCESS_CONTROL.DENIED,
    label: string,
    organizationId: string | null
): Promise<Map<string, postgres.get_resp_t> | null> {
    const startMs = performance.now();
    try {
        const admitted = await waitingRoomStore.admitBatch(
            admissions,
            accessControl,
            organizationId
        );
        const elapsed = performance.now() - startMs;
        Observability.recordDbTiming(`waitingroom.admit.${label}`, elapsed);
        logger.debug(
            'waiting-room admit label=%s org=%s access=%d requested=%d returned=%d ms=%d',
            label,
            organizationId ?? '<none>',
            accessControl,
            admissions.length,
            admitted.length,
            Math.round(elapsed)
        );
        return new Map(
            admitted
                .filter((r) => r.external_id)
                .filter((r) => isGenuineAdmit(r, accessControl))
                .map((r) => [r.external_id as string, r])
        );
    } catch (err) {
        const elapsed = performance.now() - startMs;
        Observability.recordDbTiming(`waitingroom.admit.${label}`, elapsed);
        // A whole batch failing (incl. the allowed-needs-org constraint) is an
        // error, not a warning — every device in it is bucketed as failed.
        Observability.incrementCounter('waiting_room_admit_failed');
        logger.error(
            'Batch %s failed for %d devices: %s',
            label,
            admissions.length,
            err
        );
        return null;
    }
}

// DB already ALLOWED. Hook errors must not roll back metric/audit/success.
async function fireApproveSideEffects(
    shellyID: string,
    record: postgres.get_resp_t,
    beforeApprove?: (record: postgres.get_resp_t) => Promise<void>
): Promise<void> {
    try {
        if (beforeApprove) await beforeApprove(record);
        const device = pendingDevices.take(shellyID);
        if (device) {
            reconnectLimiter.clear(shellyID);
            fireOnApproveSafe(device.onApprove, shellyID);
            // DB admit already landed; a live socket registers now, else the
            // device only registers on its next report (the latency to hunt).
            ingressStage(shellyID, 'accept', 'live socket — registering now');
        } else {
            ingressStage(
                shellyID,
                'accept',
                'no live socket — registers on next report'
            );
        }
    } catch (err) {
        logger.warn(
            'Post-approve side effects failed for %s (DB already ALLOWED): %s',
            shellyID,
            err
        );
    }
}

export interface ClaimApproveResult {
    success: string[];
    error: string[];
    records: postgres.get_resp_t[];
}

export interface AcceptChunkProgress {
    accepted: number;
    failed: string[];
}

// Called after each batch; return false to stop (cancellation).
export type AcceptChunkHook = (
    progress: AcceptChunkProgress
) => Promise<boolean>;

// Atomic claim wins once. Chunking lives here only: every caller batches
// through acceptChunkSize, and onChunk drives progress/cancellation.
export async function claimAndApproveByExternalIds(
    organizationId: string,
    externalIds: string[],
    username?: string,
    beforeApprove?: (record: postgres.get_resp_t) => Promise<void>,
    onChunk?: AcceptChunkHook
): Promise<ClaimApproveResult> {
    const result: ClaimApproveResult = {success: [], error: [], records: []};
    const chunks = chunkIds(externalIds, acceptChunkSize());
    const waveSize = tuning.waitingRoom.acceptConcurrency;
    // Chunks bound each DB write; waves run them concurrently. Cancel skips the
    // next wave; the in-flight wave finishes.
    let canceled = false;
    for (let i = 0; i < chunks.length && !canceled; i += waveSize) {
        const wave = chunks.slice(i, i + waveSize);
        const waveStart = performance.now();
        const settled = await Promise.allSettled(
            wave.map((chunk) =>
                claimAndApproveChunk(
                    organizationId,
                    chunk,
                    username,
                    beforeApprove
                )
            )
        );
        for (let j = 0; j < settled.length; j++) {
            const outcome = settled[j];
            if (outcome.status === 'rejected') {
                // Whole chunk failed — report its devices as errors so the UI
                // restores them.
                logger.error(
                    'Bulk accept chunk failed (%d devices): %s',
                    wave[j].length,
                    outcome.reason
                );
                result.error.push(...wave[j]);
                continue;
            }
            const part = outcome.value;
            result.success.push(...part.success);
            result.error.push(...part.error);
            result.records.push(...part.records);
            if (
                onChunk &&
                !(await onChunk({
                    accepted: part.success.length,
                    failed: part.error
                }))
            ) {
                canceled = true;
            }
        }
        logger.debug(
            'waiting-room accept wave org=%s wave=%d chunks=%d ids=%d ms=%d canceled=%s',
            organizationId,
            Math.floor(i / waveSize) + 1,
            wave.length,
            wave.reduce((sum, chunk) => sum + chunk.length, 0),
            Math.round(performance.now() - waveStart),
            canceled
        );
    }
    return result;
}

function acceptChunkSize(): number {
    return tuning.waitingRoom.acceptChunkSize;
}

function chunkIds(ids: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += size) {
        chunks.push(ids.slice(i, i + size));
    }
    return chunks;
}

async function claimAndApproveChunk(
    organizationId: string,
    externalIds: string[],
    username?: string,
    beforeApprove?: (record: postgres.get_resp_t) => Promise<void>
): Promise<ClaimApproveResult> {
    const claimStart = performance.now();
    const claims = await claimPendingEntries(organizationId, externalIds);
    const claimMs = performance.now() - claimStart;
    const fallbackIds = externalIds.filter((id) => !claims.has(id));

    const approveStart = performance.now();
    const claimed = await approveClaimedEntries(
        organizationId,
        [...claims.values()],
        username,
        beforeApprove
    );
    const approveMs = performance.now() - approveStart;

    const fallbackStart = performance.now();
    const fallback =
        fallbackIds.length > 0
            ? await approveDevicesByExternalIds(
                  fallbackIds,
                  username,
                  beforeApprove,
                  organizationId
              )
            : {success: [], error: [], records: []};
    const fallbackMs = performance.now() - fallbackStart;

    Observability.recordRpcTiming('waitingroom.accept.claim', claimMs);
    Observability.recordRpcTiming(
        'waitingroom.accept.claimed_admit',
        approveMs
    );
    Observability.recordRpcTiming(
        'waitingroom.accept.fallback_admit',
        fallbackMs
    );
    logger.debug(
        'waiting-room accept chunk org=%s ids=%d claimed=%d fallback=%d success=%d error=%d claimMs=%d claimedMs=%d fallbackMs=%d',
        organizationId,
        externalIds.length,
        claims.size,
        fallbackIds.length,
        claimed.success.length + fallback.success.length,
        claimed.error.length + fallback.error.length,
        Math.round(claimMs),
        Math.round(approveMs),
        Math.round(fallbackMs)
    );

    return {
        success: [...claimed.success, ...fallback.success],
        error: [...claimed.error, ...fallback.error],
        records: [...claimed.records, ...fallback.records]
    };
}

async function claimPendingEntries(
    organizationId: string,
    externalIds: string[]
): Promise<Map<string, WaitingEntry>> {
    const claimed = new Map<string, WaitingEntry>();
    const results = await Promise.all(
        externalIds.map(async (shellyID) => ({
            shellyID,
            entry: await claimPendingSafe(organizationId, shellyID)
        }))
    );
    for (const {shellyID, entry} of results) {
        if (entry) claimed.set(shellyID, entry);
    }
    return claimed;
}

async function claimPendingSafe(
    organizationId: string,
    shellyID: string
): Promise<WaitingEntry | null> {
    try {
        const claimed = await claimPending(organizationId, shellyID);
        if (claimed) return claimed;
        return await claimLegacyDefaultOrg(organizationId, shellyID);
    } catch (err) {
        logger.warn('Store claim failed for %s: %s', shellyID, err);
        return null;
    }
}

// Claim legacy entries under their recorded default org.
async function claimLegacyDefaultOrg(
    operatorOrganizationId: string,
    shellyID: string
): Promise<WaitingEntry | null> {
    const defaultOrg = gatelessDeviceOrg();
    if (!defaultOrg || operatorOwnsGatelessOrg(operatorOrganizationId)) {
        return null;
    }
    const entries = await listPending(defaultOrg);
    const match = entries.find(
        (entry) => entry.shellyID === shellyID && entry.authMethod === 'none'
    );
    if (!match) return null;
    return claimPending(defaultOrg, shellyID);
}

async function approveClaimedEntries(
    organizationId: string,
    entries: WaitingEntry[],
    username?: string,
    beforeApprove?: (record: postgres.get_resp_t) => Promise<void>
): Promise<ClaimApproveResult> {
    const success: string[] = [];
    const error: string[] = [];
    const records: postgres.get_resp_t[] = [];
    if (entries.length === 0) return {success, error, records};

    const admissions = entries.map((entry) => ({
        externalId: entry.shellyID,
        jdoc: {shellyID: entry.shellyID, status: entry.jdoc}
    }));
    const admittedByExtId = await runAdmissionBatch(
        admissions,
        postgres.ACCESS_CONTROL.ALLOWED,
        'claim-approve',
        organizationId
    );
    if (!admittedByExtId) {
        // Claim already removed them; admit failed, so put them back.
        await restoreClaimedEntries(entries);
        for (const entry of entries) error.push(entry.shellyID);
        debouncedNotifyWaitingRoom();
        return {success, error, records};
    }

    const failed: WaitingEntry[] = [];
    for (const entry of entries) {
        const record = admittedByExtId.get(entry.shellyID);
        if (!record) {
            failed.push(entry);
            error.push(entry.shellyID);
            continue;
        }
        Observability.incrementCounter('waiting_room_approved');
        logAudit((audit) => audit.logDeviceAdd(entry.shellyID, username));
        success.push(entry.shellyID);
        records.push(record);
        // Drop cached PENDING so a fast reconnect auto-admits.
        await invalidateAccessControl(entry.shellyID);
        await fireApproveSideEffects(entry.shellyID, record, beforeApprove);
    }
    if (failed.length > 0) await restoreClaimedEntries(failed);
    debouncedNotifyWaitingRoom();
    return {success, error, records};
}

async function restoreClaimedEntries(entries: WaitingEntry[]): Promise<void> {
    await Promise.all(
        entries.map(async (entry) => {
            try {
                await restoreClaimedPending(entry);
            } catch (err) {
                logger.warn(
                    'Failed to restore claimed entry %s: %s',
                    entry.shellyID,
                    err
                );
            }
        })
    );
}

interface DenyImplInput {
    organizationId: string | undefined;
    externalIds: string[];
    username: string | undefined;
    kind: 'deny' | 'quarantine';
}

// Shared backbone for deny + quarantine. Claims the live store entries so the
// permanent denied row keeps each device's status snapshot — the same way the
// accept path snapshots the allowed row. A device absent from the store is
// denied in absentia: jdoc null so the SQL NULLIF preserves any existing row.
async function denyByExternalIdsImpl(input: DenyImplInput) {
    const {organizationId, externalIds, username, kind} = input;
    const success: string[] = [];
    const error: string[] = [];
    const deniedIds: number[] = [];

    if (externalIds.length === 0) return {success, error, deniedIds};

    // A null org would let the DENIED flip hit another org's row by its
    // globally-unique external_id; refuse rather than run unscoped.
    if (!organizationId) {
        logger.error(
            'denyByExternalIdsImpl called without an organization for %d device(s) — refusing unscoped %s',
            externalIds.length,
            kind
        );
        for (const id of externalIds) error.push(id);
        return {success, error, deniedIds};
    }

    const claims = await claimPendingEntries(organizationId, externalIds);
    const admissions = externalIds.map((shellyID) => {
        const entry = claims.get(shellyID);
        return {
            externalId: shellyID,
            jdoc: entry ? {shellyID, status: entry.jdoc} : null
        };
    });

    // Scope the deny to the caller's org; fn_admit_batch only flips
    // own-or-unowned rows, so NULL-org legacy rows stay denyable.
    const admittedByExtId = await runAdmissionBatch(
        admissions,
        postgres.ACCESS_CONTROL.DENIED,
        kind,
        organizationId
    );
    if (!admittedByExtId) {
        await restoreClaimedEntries([...claims.values()]);
        for (const id of externalIds) error.push(id);
        return {success, error, deniedIds};
    }

    const counter =
        kind === 'quarantine'
            ? 'waiting_room_quarantined'
            : 'waiting_room_denied';

    const failed: WaitingEntry[] = [];
    for (const shellyID of externalIds) {
        const record = admittedByExtId.get(shellyID);
        if (!record) {
            const claimed = claims.get(shellyID);
            if (claimed) failed.push(claimed);
            error.push(shellyID);
            continue;
        }
        Observability.incrementCounter(counter);
        logAudit((audit) => audit.logDeviceDelete(shellyID, username));
        success.push(shellyID);
        deniedIds.push(record.id);
        await invalidateAccessControl(shellyID);
        fireDenySideEffects(shellyID, kind);
    }
    if (failed.length > 0) await restoreClaimedEntries(failed);
    return {success, error, deniedIds};
}

// DB already DENIED. Hook errors logged, never propagated.
function fireDenySideEffects(
    shellyID: string,
    kind: 'deny' | 'quarantine'
): void {
    try {
        const device = pendingDevices.take(shellyID);
        if (device) {
            reconnectLimiter.clear(shellyID);
            if (kind === 'quarantine') device.onQuarantine();
            else device.onDeny();
        }
        DeviceCollector.deleteDevice(shellyID);
    } catch (err) {
        logger.warn(
            'Post-%s side effects failed for %s (DB already DENIED): %s',
            kind,
            shellyID,
            err
        );
    }
}

// Destructive Quarantine — persists DENIED in DB AND rewrites the device's
// own WS config + reboots it. Recovery requires factory-reset on the device.
// Reserved for adversarial / "must-stop-hammering-us" cases. The default
// admin-block path is denyDevicesByExternalIds (polite close).
export async function quarantineDevicesByExternalIds(
    externalIds: string[],
    username?: string,
    organizationId?: string
) {
    const result = await denyByExternalIdsImpl({
        organizationId,
        externalIds,
        username,
        kind: 'quarantine'
    });
    if (organizationId) {
        await dropStoreEntries(organizationId, result.success);
    }
    debouncedNotifyWaitingRoom();
    return result;
}

// Authenticated reject; persists DENIED so the device stops auto-queueing.
export async function denyDevicesByExternalIds(
    externalIds: string[],
    username?: string,
    organizationId?: string
) {
    const result = await denyByExternalIdsImpl({
        organizationId,
        externalIds,
        username,
        kind: 'deny'
    });
    if (organizationId) {
        await applyRejectCooldown(organizationId, result.success);
        await dropStoreEntries(organizationId, result.success);
    }
    debouncedNotifyWaitingRoom();
    return result;
}

// A polite reject keeps the device connecting, so suppress re-queue churn for
// a short window — operator org plus the legacy default org. Quarantine does
// not use this: a quarantined device is rebooted and silenced, so the only
// guard is the permanent DENIED row, not a TTL cooldown.
async function applyRejectCooldown(
    organizationId: string,
    shellyIDs: string[]
): Promise<void> {
    for (const shellyID of shellyIDs) {
        try {
            await onOperatorAndLegacyOrg(
                organizationId,
                shellyID,
                markRejected
            );
        } catch (err) {
            logger.warn('Reject cooldown failed for %s: %s', shellyID, err);
        }
    }
}

// Safety net for a transient claim failure: the claim removes the entry on the
// common path; this clears any leftover.
async function dropStoreEntries(
    organizationId: string,
    shellyIDs: string[]
): Promise<void> {
    for (const shellyID of shellyIDs) {
        try {
            await onOperatorAndLegacyOrg(organizationId, shellyID, dropPending);
        } catch (err) {
            logger.warn('Store cleanup failed for %s: %s', shellyID, err);
        }
    }
}

// A pending device lives under the operator org and, when it arrived
// unidentified, the legacy default org — apply the store op to both.
async function onOperatorAndLegacyOrg(
    organizationId: string,
    shellyID: string,
    apply: (org: string, shellyID: string) => Promise<unknown>
): Promise<void> {
    await apply(organizationId, shellyID);
    const defaultOrg = gatelessDeviceOrg();
    if (defaultOrg && !operatorOwnsGatelessOrg(organizationId)) {
        await apply(defaultOrg, shellyID);
    }
}

export async function denyDevice(id: number, username?: string) {
    await waitingRoomStore.denyAccessControl(id);
    const taken = await takeDecidedDevice(id);
    if (!taken) return false;
    const {externalId, device} = taken;
    if (device) {
        reconnectLimiter.clear(externalId);
        device.onDeny();
        Observability.incrementCounter('waiting_room_denied');
        logAudit((audit) => audit.logDeviceDelete(externalId, username));
    }
    DeviceCollector.deleteDevice(externalId);
    debouncedNotifyWaitingRoom();
    return !!device;
}

export async function getDenied() {
    const response = await waitingRoomStore.getDeniedDevices();
    const devices: Record<string, any> = {};
    for (const dev of response) {
        // external_id is the device identity; dev.id is an internal serial.
        const payload = sanitizePendingPayload(dev.jdoc);
        payload.shellyID = dev.external_id;
        devices[dev.external_id] = payload;
    }
    return devices;
}

export function stop() {
    if (wrNotifyTimer) {
        clearTimeout(wrNotifyTimer);
        wrNotifyTimer = null;
    }
    pendingDevices.stop();
    reconnectLimiter.clearAll();
}

Observability.registerModule('waitingRoom', {
    stats: () => ({
        pendingDevices: pendingDevices.size(),
        reconnectLimiterKeys: reconnectLimiter.size()
    }),
    topology: {
        role: 'transform',
        cluster: 'ingest',
        zone: 'device_admission',
        upstreams: ['devices'],
        downstreams: ['deviceInit'],
        label: 'Waiting Room',
        description: 'Pending device approvals',
        route: '/monitoring/device-ingest'
    }
});
