/**
 * OutboxWorker — graphile-worker runner for delivery_jobs.
 *
 * Each alert-driven job gets a `delivery_send` task carrying the row
 * id. The task claims, decrypts secrets, calls the adapter, records
 * the attempt. graphile-worker owns retries; we flag the final attempt
 * so the domain row moves to a terminal state instead of stranding at
 * 'processing'.
 */
import {
    type JobHelpers,
    type Runner,
    run,
    type TaskList
} from 'graphile-worker';
import * as log4js from 'log4js';
import type {config_rc_t} from '../../config';
import {tuning} from '../../config/tuning';
import type {ReportExportPayload} from '../../model/energy/reportExportPayload';
import type {ChannelProvider} from '../../types/api/channel';
import * as AlertEvents from '../AlertEvents';
import {BoundedMap} from '../boundedMap';
import {mergeIntegrationConfig} from '../integrationConfig';
import {resolveMessageTemplate} from '../notification/messageTemplateResolver';
import {standardResolvedMessageTemplate} from '../notification/standardMessageTemplate';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {decryptJsonSecret} from '../secretCrypto';
import {formatError} from '../util/formatError';
import {getAdapter} from './adapters';
import {
    type DeliveryAuditChannelKind,
    type DeliveryAuditOutcome,
    DeliveryRecipientAudit
} from './audit/DeliveryRecipientAudit';
import {
    type RecordedAttempt,
    recordDeliveryAttempt
} from './DeliveryAttemptRecorder';
import {classifyDeliveryFailure} from './DeliveryFailureClassifier';
import {
    startDeliveryMetricsPolling,
    stopDeliveryMetricsPolling
} from './DeliveryMetrics';
import {enforceDeliveryRateLimit} from './DeliveryRateLimiter';
import {resolveEmailTemplateConfig} from './emailTemplateResolver';
import {applyEmailRecipientSuppressions} from './RecipientSuppressionFilter';
import {endpointTemplateId, prepareTemplatedSend} from './templatedSend';
import type {DeliveryContext, DeliveryPayload, DeliveryResult} from './types';

const logger = log4js.getLogger('OutboxWorker');

const TASK_SEND = 'delivery_send';
const TASK_MOTION_CLEAR = 'motion_clear';
const TASK_OFFLINE_FIRE = 'device_offline_fire_pending';
const TASK_STATE_HOLD = 'entity_state_hold';
const TASK_GROUP_FLUSH = 'delivery_group_flush';
const TASK_GROUP_REPEAT_SWEEP = 'delivery_group_repeat_sweep';
const TASK_RECLAIM_STRANDED = 'delivery_job_reclaim_stranded';
const TASK_RECORD_RECONCILE = 'delivery_record_reconcile';
const TASK_ESCALATION_STAGE = 'delivery_escalation_stage';
const TASK_DIGEST_FLUSH = 'notification_digest_flush';
const TASK_REPORT_EXPORT = 'report_export';
const RECLAIM_LEADER_NAME = 'outbox-reclaim-stranded';
const DIGEST_LEADER_NAME = 'notification-digest-flush';

let runner: Runner | null = null;

// --- Job payloads --------------------------------------------------------

export interface DeliverySendPayload {
    deliveryJobId: number;
    /** Pre-built human-facing message. Worker never re-derives it. */
    message: DeliveryPayload;
}

// A succeeded delivery whose terminal-state write failed. Durable job that
// retries the record-write so the reclaim cron can't mis-mark it failed.
export interface DeliveryRecordReconcilePayload {
    deliveryJobId: number;
    organizationId: string;
    endpointId: number;
    httpStatus?: number | null;
    providerCode?: string | null;
}

/** Scheduled motion-clear task. AlertEngine passes the callback inline. */
export type MotionClearHandler = (params: {
    organizationId: string;
    ruleId: number;
    fingerprint: string;
}) => Promise<void>;
let motionClearHandler: MotionClearHandler | null = null;

export function registerMotionClearHandler(h: MotionClearHandler): void {
    motionClearHandler = h;
}

export interface MotionClearPayload {
    organizationId: string;
    ruleId: number;
    fingerprint: string;
}

// Deferred device_offline fire (rule.config.offlineForSec window).
export type OfflineFireHandler = (params: {
    organizationId: string;
    ruleId: number;
    shellyID: string;
}) => Promise<void>;
let offlineFireHandler: OfflineFireHandler | null = null;

export function registerOfflineFireHandler(h: OfflineFireHandler): void {
    offlineFireHandler = h;
}

export interface StateHoldPayload {
    organizationId: string;
    ruleId: number;
    shellyID: string;
    component: string;
    field: string;
    fingerprintV2?: string;
    equals?: boolean | string | number;
    // How many times the fire was deferred because the device wasn't back yet
    // (e.g. right after a restart). Bounds the reschedule so it can't loop.
    attempt?: number;
}
export type StateHoldHandler = (p: StateHoldPayload) => Promise<void>;
let stateHoldHandler: StateHoldHandler | null = null;

export function registerStateHoldHandler(h: StateHoldHandler): void {
    stateHoldHandler = h;
}

// The graphile task that fires a held entity_state alert when its timer
// elapses. Named (not inline in start's taskList) so an integration test can
// run the real wiring against a real runner and prove the durable path.
async function runStateHoldTask(payload: unknown): Promise<void> {
    if (!stateHoldHandler) {
        logger.warn('entity_state_hold fired without handler');
        return;
    }
    await stateHoldHandler(payload as StateHoldPayload);
}

export interface OfflineFirePayload {
    organizationId: string;
    ruleId: number;
    shellyID: string;
}

export interface DeliveryGroupFlushPayload {
    groupId: number;
}

export interface DeliveryEscalationStagePayload {
    organizationId: string;
    alertId: number;
    ruleId: number;
    stageId: string;
    stage: unknown;
}

/** Flush handler lives in AlertEngine (has the DeliveryPayload builder). */
export type GroupFlushHandler = (groupId: number) => Promise<void>;
let groupFlushHandler: GroupFlushHandler | null = null;
export function registerGroupFlushHandler(h: GroupFlushHandler): void {
    groupFlushHandler = h;
}

export type EscalationStageHandler = (
    payload: DeliveryEscalationStagePayload
) => Promise<void>;
let escalationStageHandler: EscalationStageHandler | null = null;
export function registerEscalationStageHandler(
    handler: EscalationStageHandler
): void {
    escalationStageHandler = handler;
}

export type DigestFlushHandler = () => Promise<void>;
let digestFlushHandler: DigestFlushHandler | null = null;
export function registerDigestFlushHandler(handler: DigestFlushHandler): void {
    digestFlushHandler = handler;
}

// Runs a queued raw report export. Scope is resolved before the job is queued,
// so the handler needs no CommandSender and survives a worker restart.
export type ReportExportHandler = (
    payload: ReportExportPayload
) => Promise<void>;
let reportExportHandler: ReportExportHandler | null = null;
export function registerReportExportHandler(
    handler: ReportExportHandler
): void {
    reportExportHandler = handler;
}

// --- Enqueue API ---------------------------------------------------------

/** Called by AlertEngine after delivery_jobs rows are inserted. */
export async function enqueueSend(payload: DeliverySendPayload): Promise<void> {
    if (!runner) {
        logger.warn(
            'enqueueSend before OutboxWorker.start — dropping job %d',
            payload.deliveryJobId
        );
        return;
    }
    await runner.addJob(TASK_SEND, payload, {
        maxAttempts: tuning.delivery.outboxMaxAttempts
    });
}

// Queue a raw report export for durable, restart-surviving execution. Throws
// when the worker is not running so the caller can fall back to in-process.
export async function enqueueReportExport(
    payload: ReportExportPayload
): Promise<void> {
    if (!runner) throw new Error('OutboxWorker not started');
    await runner.addJob(TASK_REPORT_EXPORT, payload, {
        maxAttempts: tuning.report.exportMaxAttempts
    });
}

/** Mark a delivery_job as failed before it has been claimed and sent.
 *  Used by AlertEngine when dispatch / flush-enqueue raises an error
 *  and would otherwise leave the queued row orphaned (no graphile-worker
 *  job will ever pick it up).
 *
 *  Symmetric to the internal markJobFailed() used after claim — same
 *  recordDeliveryAttempt(..., final=true) call, plus the WS delivery-updated emit.
 */
export async function abortPendingJob(input: {
    jobId: number;
    organizationId: string;
    endpointId: number;
    reason: string;
}): Promise<void> {
    const attempt = await recordDeliveryAttempt({
        jobId: input.jobId,
        result: {state: 'failed', errorMessage: input.reason},
        final: true
    });
    emitDeliveryUpdated(
        input.organizationId,
        input.jobId,
        input.endpointId,
        attempt?.job_state ?? 'dead_letter'
    );
}

/** Schedule a group flush. jobKeyMode=replace so multiple alerts landing
 *  in the same open group share one flush run. `force` triggers the
 *  storm-cap immediate flush (runAt=now). */
export async function enqueueGroupFlush(
    groupId: number,
    runAt: Date,
    force = false
): Promise<void> {
    if (!runner) {
        logger.warn(
            'enqueueGroupFlush before OutboxWorker.start — dropping group %d',
            groupId
        );
        return;
    }
    await runner.addJob(
        TASK_GROUP_FLUSH,
        {groupId} as DeliveryGroupFlushPayload,
        {
            runAt,
            jobKey: `group_flush:${groupId}`,
            jobKeyMode: force ? 'replace' : 'preserve_run_at',
            maxAttempts: tuning.delivery.outboxMaxAttempts
        }
    );
}

export async function enqueueEscalationStage(
    payload: DeliveryEscalationStagePayload,
    runAt: Date
): Promise<void> {
    if (!runner) {
        logger.warn(
            'enqueueEscalationStage before OutboxWorker.start — dropping alert %d stage %s',
            payload.alertId,
            payload.stageId
        );
        return;
    }
    await runner.addJob(TASK_ESCALATION_STAGE, payload, {
        runAt,
        jobKey: `delivery_escalation:${payload.alertId}:${payload.stageId}`,
        jobKeyMode: 'preserve_run_at',
        maxAttempts: tuning.delivery.outboxMaxAttempts
    });
}

/** Deterministic job key — same rule+fingerprint always maps to the same row. */
function motionClearJobKey(ruleId: number, fingerprint: string): string {
    return `motion_clear:${ruleId}:${fingerprint}`;
}

/** Schedule a motion auto-resolve. Re-invoking replaces the pending row. */
export async function enqueueMotionClear(
    payload: MotionClearPayload,
    runAt: Date
): Promise<void> {
    if (!runner) {
        logger.warn(
            'enqueueMotionClear before OutboxWorker.start — dropping rule %d',
            payload.ruleId
        );
        return;
    }
    await runner.addJob(TASK_MOTION_CLEAR, payload, {
        runAt,
        jobKey: motionClearJobKey(payload.ruleId, payload.fingerprint),
        jobKeyMode: 'replace'
    });
}

/**
 * Cancel a pending motion-clear task. Returns true on success, false on
 * DB error so the caller can flag "auto-resolve may still fire" — the
 * old swallow-and-warn variant let an ack-after-DB-blip silently
 * re-trigger the motion-clear callback.
 */
export async function cancelMotionClear(
    ruleId: number,
    fingerprint: string
): Promise<boolean> {
    try {
        await PostgresProvider.callMethod(
            'notifications.fn_cancel_scheduled_worker_job',
            {p_key: motionClearJobKey(ruleId, fingerprint)}
        );
        return true;
    } catch (err) {
        Observability.incrementCounter('outbox_motion_clear_cancel_errors');
        logger.error(
            'cancelMotionClear rule=%d fingerprint=%s failed — auto-resolve may still fire: %s',
            ruleId,
            fingerprint,
            formatError(err)
        );
        return false;
    }
}

function offlineFireJobKey(ruleId: number, shellyID: string): string {
    return `device_offline_fire:${ruleId}:${shellyID}`;
}

// jobKeyMode='replace' so a second disconnect resets the timer.
export async function enqueueOfflineFire(
    payload: OfflineFirePayload,
    runAt: Date
): Promise<void> {
    if (!runner) {
        logger.warn(
            'enqueueOfflineFire before OutboxWorker.start — dropping rule %d',
            payload.ruleId
        );
        return;
    }
    await runner.addJob(TASK_OFFLINE_FIRE, payload, {
        runAt,
        jobKey: offlineFireJobKey(payload.ruleId, payload.shellyID),
        jobKeyMode: 'replace'
    });
}

export async function cancelOfflineFire(
    ruleId: number,
    shellyID: string
): Promise<boolean> {
    try {
        await PostgresProvider.callMethod(
            'notifications.fn_cancel_scheduled_worker_job',
            {p_key: offlineFireJobKey(ruleId, shellyID)}
        );
        return true;
    } catch (err) {
        Observability.incrementCounter('outbox_offline_fire_cancel_errors');
        logger.error(
            'cancelOfflineFire rule=%d shellyID=%s failed — deferred fire may still arrive: %s',
            ruleId,
            shellyID,
            formatError(err)
        );
        return false;
    }
}

// Per (rule, device, component.field) so each relay holds independently.
function stateHoldJobKey(
    ruleId: number,
    shellyID: string,
    component: string,
    field: string
): string {
    return `entity_state_hold:${ruleId}:${shellyID}:${component}.${field}`;
}

// jobKeyMode='replace' so re-entering the target state resets the hold timer.
export async function enqueueStateHold(
    payload: StateHoldPayload,
    runAt: Date
): Promise<void> {
    if (!runner) {
        logger.warn(
            'enqueueStateHold before OutboxWorker.start — dropping rule %d',
            payload.ruleId
        );
        return;
    }
    await runner.addJob(TASK_STATE_HOLD, payload, {
        runAt,
        jobKey: stateHoldJobKey(
            payload.ruleId,
            payload.shellyID,
            payload.component,
            payload.field
        ),
        jobKeyMode: 'replace'
    });
}

export async function cancelStateHold(
    ruleId: number,
    shellyID: string,
    component: string,
    field: string
): Promise<boolean> {
    try {
        await PostgresProvider.callMethod(
            'notifications.fn_cancel_scheduled_worker_job',
            {p_key: stateHoldJobKey(ruleId, shellyID, component, field)}
        );
        return true;
    } catch (err) {
        Observability.incrementCounter('outbox_state_hold_cancel_errors');
        logger.error(
            'cancelStateHold rule=%d shellyID=%s %s.%s failed: %s',
            ruleId,
            shellyID,
            component,
            field,
            formatError(err)
        );
        return false;
    }
}

// --- Lifecycle -----------------------------------------------------------

// graphile increments attempts at claim, so job.attempts is the current
// (1-based) attempt and it stops retrying at attempts >= max_attempts. The
// final attempt is exactly that boundary — no +1 (which would burn a retry).
export function isFinalAttempt(job: {
    attempts: number;
    max_attempts: number;
}): boolean {
    return job.attempts >= job.max_attempts;
}

// graphile expands `*/N` over minutes 0..59, so N>=60 silently collapses to a
// single run at :00 (hourly). Clamp to [1,59] and warn so an interval config
// above an hour degrades loudly instead of changing cadence behind our back.
export function cronMinuteInterval(minutes: number, label: string): number {
    const clamped = Math.min(59, Math.max(1, Math.floor(minutes)));
    if (clamped !== minutes) {
        logger.warn(
            'cron %s interval %d min clamped to %d (must be 1-59 for a minute schedule)',
            label,
            minutes,
            clamped
        );
    }
    return clamped;
}

export async function start(
    storageConfig: config_rc_t['internalStorage']
): Promise<void> {
    if (runner) return;
    const connectionString =
        PostgresProvider.buildConnectionString(storageConfig);
    if (!connectionString) {
        throw new Error(
            'OutboxWorker.start: internalStorage.connection config is missing'
        );
    }
    // Leader gate so only one pod actually runs the reclaim sweep per
    // cycle even though graphile schedules the cron on every worker.
    void startLeaderGate(RECLAIM_LEADER_NAME);
    void startLeaderGate(DIGEST_LEADER_NAME);
    runner = await run({
        connectionString,
        concurrency: tuning.delivery.outboxConcurrency,
        noHandleSignals: true, // app.ts owns SIGTERM/SIGINT
        crontab: [
            `*/${cronMinuteInterval(Math.floor(tuning.alert.groupIntervalSec / 60), 'group-repeat-sweep')} * * * * ${TASK_GROUP_REPEAT_SWEEP}`,
            `*/${cronMinuteInterval(tuning.delivery.outboxReclaimIntervalMinutes, 'reclaim-stranded')} * * * * ${TASK_RECLAIM_STRANDED}`,
            `*/${cronMinuteInterval(tuning.delivery.digestFlushIntervalMinutes, 'digest-flush')} * * * * ${TASK_DIGEST_FLUSH}`
        ].join('\n'),
        taskList: {
            [TASK_SEND]: async (payload, helpers) => {
                await processSendJob({
                    payload: payload as DeliverySendPayload,
                    finalAttempt: isFinalAttempt(helpers.job),
                    helpers
                });
            },
            [TASK_MOTION_CLEAR]: async (payload) => {
                if (!motionClearHandler) {
                    logger.warn('motion_clear fired without handler');
                    return;
                }
                await motionClearHandler(payload as MotionClearPayload);
            },
            [TASK_OFFLINE_FIRE]: async (payload) => {
                if (!offlineFireHandler) {
                    logger.warn(
                        'device_offline_fire_pending fired without handler'
                    );
                    return;
                }
                await offlineFireHandler(payload as OfflineFirePayload);
            },
            [TASK_STATE_HOLD]: runStateHoldTask,
            [TASK_GROUP_FLUSH]: async (payload) => {
                if (!groupFlushHandler) {
                    logger.warn('delivery_group_flush fired without handler');
                    return;
                }
                const p = payload as DeliveryGroupFlushPayload;
                await groupFlushHandler(p.groupId);
            },
            [TASK_GROUP_REPEAT_SWEEP]: async () => {
                await sweepRepeatDueGroups();
            },
            [TASK_RECLAIM_STRANDED]: async () => {
                await reclaimStrandedJobs();
            },
            [TASK_RECORD_RECONCILE]: async (payload) => {
                await reconcileRecord(
                    payload as DeliveryRecordReconcilePayload
                );
            },
            [TASK_ESCALATION_STAGE]: async (payload) => {
                if (!escalationStageHandler) {
                    logger.warn(
                        'delivery_escalation_stage fired without handler'
                    );
                    return;
                }
                await escalationStageHandler(
                    payload as DeliveryEscalationStagePayload
                );
            },
            [TASK_DIGEST_FLUSH]: async () => {
                await flushNotificationDigests();
            },
            [TASK_REPORT_EXPORT]: async (payload) => {
                if (!reportExportHandler) {
                    logger.warn('report_export fired without handler');
                    return;
                }
                await reportExportHandler(payload as ReportExportPayload);
            }
        }
    });
    logger.info(
        'OutboxWorker started — concurrency %d',
        tuning.delivery.outboxConcurrency
    );
    startDeliveryMetricsPolling(tuning.delivery.metricsPollMs);
}

// --- Repeat-interval sweep ----------------------------------------------

// Crash-recovery: mark delivery_jobs stuck in 'processing' as 'failed'
// (outcome unknown). The original DeliveryPayload lives in graphile_worker
// and is unrecoverable once that row is gone — returning the domain row
// to 'queued' would leave an orphan no scanner could pick up, and risks
// a double-send if the adapter actually delivered before the crash.
// Operator can manually re-trigger via the UI on observed failures.
async function reclaimStrandedJobs(
    options: {requireLeadership?: boolean} = {}
): Promise<number> {
    if ((options.requireLeadership ?? true) && !isLeader(RECLAIM_LEADER_NAME)) {
        return 0;
    }
    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_delivery_job_reclaim_stranded',
            {p_stale_ms: tuning.delivery.outboxReclaimStaleMs}
        );
        const reclaimed = Number(
            result?.rows?.[0]?.fn_delivery_job_reclaim_stranded ?? 0
        );
        if (reclaimed > 0) {
            logger.warn(
                'outbox reclaim: marked %d stranded jobs as failed (outcome unknown)',
                reclaimed
            );
            Observability.incrementCounter('outbox_jobs_reclaimed', reclaimed);
        }
        return reclaimed;
    } catch (err) {
        // Count it: a persistent failure here silently strands 'processing'
        // rows forever, so it must be visible to monitoring, not just logs.
        Observability.incrementCounter('outbox_reclaim_sweep_errors');
        logger.error('outbox reclaim sweep failed: %s', formatError(err));
        return 0;
    }
}

async function sweepRepeatDueGroups(): Promise<void> {
    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_delivery_group_repeat_due',
            {p_threshold_seconds: tuning.alert.repeatIntervalSec}
        );
        const rows = (result?.rows ?? []) as Array<{group_id: number}>;
        for (const {group_id} of rows) {
            await enqueueGroupFlush(group_id, new Date(), true);
        }
        if (rows.length > 0) {
            logger.info(
                'alert-group repeat sweep flushed %d groups',
                rows.length
            );
        }
    } catch (err) {
        Observability.incrementCounter('outbox_repeat_sweep_errors');
        logger.error('alert-group repeat sweep failed: %s', formatError(err));
    }
}

async function flushNotificationDigests(
    options: {requireLeadership?: boolean} = {}
): Promise<void> {
    if ((options.requireLeadership ?? true) && !isLeader(DIGEST_LEADER_NAME)) {
        return;
    }
    if (!digestFlushHandler) {
        logger.warn('notification_digest_flush fired without handler');
        return;
    }
    await digestFlushHandler();
}

export async function stop(): Promise<void> {
    if (!runner) return;
    try {
        await runner.stop();
    } catch (err) {
        logger.error('OutboxWorker stop failed: %s', formatError(err));
    }
    stopDeliveryMetricsPolling();
    runner = null;
    logger.info('OutboxWorker stopped');
}

// --- Per-job processing --------------------------------------------------

interface ClaimedJob {
    id: number;
    organization_id: string;
    alert_id: number | null;
    inbox_item_id: number | null;
    endpoint_id: number;
    provider: ChannelProvider;
    endpoint_name: string;
    endpoint_enabled: boolean;
    endpoint_config: Record<string, unknown>;
    attempt_count: number;
    in_quiet_hours: boolean;
    auto_disabled: boolean;
}

async function claim(deliveryJobId: number): Promise<ClaimedJob | undefined> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_delivery_job_claim',
        {p_id: deliveryJobId}
    );
    return result?.rows?.[0] as ClaimedJob | undefined;
}

async function lookupPreviousProviderCode(
    organizationId: string,
    alertId: number | null,
    endpointId: number
): Promise<string | undefined> {
    if (alertId == null) return undefined;
    try {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_delivery_last_success_for_alert',
            {
                p_organization_id: organizationId,
                p_alert_id: alertId,
                p_endpoint_id: endpointId
            }
        );
        const row = res?.rows?.[0] as
            | {fn_delivery_last_success_for_alert?: string | null}
            | undefined;
        const code = row?.fn_delivery_last_success_for_alert;
        return typeof code === 'string' && code.length > 0 ? code : undefined;
    } catch (err) {
        logger.warn(
            'lookupPreviousProviderCode failed (alert=%s endpoint=%d): %s',
            String(alertId),
            endpointId,
            formatError(err)
        );
        return undefined;
    }
}

// Per-(endpointId, updated_at) cache of decrypted secrets. Writes through
// endpointSecretStore bump updated_at, so stale entries become unreachable
// as soon as the SQL row is updated — no explicit invalidation needed.
const secretsCache = new BoundedMap<string, Record<string, unknown>>({
    maxSize: tuning.delivery.outboxSecretsCacheMax,
    ttlMs: tuning.delivery.outboxSecretsCacheTtlMs
});

// Returns `null` on decrypt failure so the caller can decide whether to
// proceed without secrets or fail the attempt. Empty-object successes
// are still represented as `{}` (distinguishable from null).
function decryptEndpointSecrets(
    endpointId: number,
    encryptedPayload: string
): Record<string, unknown> | null {
    try {
        const decoded = decryptJsonSecret(encryptedPayload, {
            additionalData: `integration_endpoint_secrets:endpoint:${endpointId}`
        });
        return decoded && typeof decoded === 'object'
            ? (decoded as Record<string, unknown>)
            : {};
    } catch (err) {
        Observability.incrementCounter('outbox_secret_decrypt_errors');
        logger.error(
            'secret decrypt failed for endpoint %d: %s',
            endpointId,
            formatError(err)
        );
        return null;
    }
}

// Decrypt failed for an endpoint that HAS a stored secret. Thrown so the
// attempt fails loudly and retries instead of falling through to an
// unauthenticated send with the missing credential.
class SecretsUnavailableError extends Error {
    constructor(endpointId: number) {
        super(`endpoint ${endpointId} secrets could not be decrypted`);
        this.name = 'SecretsUnavailableError';
    }
}

async function loadSecrets(
    endpointId: number
): Promise<Record<string, unknown>> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_channel_secret_get',
        {p_endpoint_id: endpointId}
    );
    const row = result?.rows?.[0] as
        | {encrypted_payload?: string; updated_at?: string | Date | null}
        | undefined;
    if (!row?.encrypted_payload) return {};

    const ts = row.updated_at;
    const updatedAtKey =
        ts == null ? '' : ts instanceof Date ? ts.toISOString() : String(ts);
    const cacheKey = `${endpointId}|${updatedAtKey}`;
    const cached = secretsCache.get(cacheKey);
    if (cached) return cached;

    const decoded = decryptEndpointSecrets(endpointId, row.encrypted_payload);
    if (decoded === null) {
        // A stored secret that won't decrypt must not silently degrade to
        // an unauthenticated send. Fail the attempt so it retries (and the
        // failure is never cached for the TTL window).
        throw new SecretsUnavailableError(endpointId);
    }
    secretsCache.set(cacheKey, decoded);
    return decoded;
}

export function __resetOutboxSecretsCacheForTests(): void {
    secretsCache.clear();
}

// Drop every cache entry for a given endpoint regardless of updated_at —
// called by ChannelComponent on endpoint update/delete so secrets
// rotated out are not kept in memory until natural TTL eviction.
export function invalidateOutboxSecretsCache(endpointId: number): void {
    const prefix = `${endpointId}|`;
    for (const key of [...secretsCache.keys()]) {
        if (key.startsWith(prefix)) secretsCache.delete(key);
    }
}

async function releaseJob(jobId: number): Promise<void> {
    await PostgresProvider.callMethod('notifications.fn_delivery_job_release', {
        p_id: jobId
    });
}

function emitDeliveryUpdated(
    organizationId: string,
    jobId: number,
    endpointId: number,
    jobState: string
): void {
    AlertEvents.emitNotificationDeliveryUpdated({
        organizationId,
        jobId,
        endpointId,
        state: jobState
    });
}

interface ProcessJobInput {
    payload: DeliverySendPayload;
    finalAttempt: boolean;
    helpers: JobHelpers;
}

// Returns true if the gate marked the job failed; caller bails out.
async function rejectIfEndpointUnavailable(job: ClaimedJob): Promise<boolean> {
    if (!job.endpoint_enabled || job.auto_disabled) {
        const reason = job.auto_disabled
            ? 'endpoint auto-disabled after repeated failures'
            : 'endpoint disabled';
        await markJobFailed(job, reason);
        return true;
    }
    return false;
}

async function markJobFailed(job: ClaimedJob, reason: string): Promise<void> {
    const attempt = await recordDeliveryAttempt({
        jobId: job.id,
        result: {state: 'failed', errorMessage: reason},
        final: true
    });
    emitDeliveryUpdated(
        job.organization_id,
        job.id,
        job.endpoint_id,
        attempt?.job_state ?? 'dead_letter'
    );
}

async function buildDeliveryContext(job: ClaimedJob): Promise<DeliveryContext> {
    const secrets = await loadSecrets(job.endpoint_id);
    let publicConfig: Record<string, unknown> = job.endpoint_config ?? {};
    if (job.provider === 'email_smtp') {
        publicConfig = await resolveEmailTemplateConfig(
            publicConfig,
            job.organization_id
        );
    }
    const previousSuccessfulProviderCode = await lookupPreviousProviderCode(
        job.organization_id,
        job.alert_id,
        job.endpoint_id
    );
    return {
        jobId: job.id,
        organizationId: job.organization_id,
        endpointId: job.endpoint_id,
        endpointName: job.endpoint_name,
        config: mergeIntegrationConfig(job.provider, publicConfig, secrets),
        ...(previousSuccessfulProviderCode
            ? {previousSuccessfulProviderCode}
            : {})
    };
}

// Honors the upstream's Retry-After window over graphile's backoff.
async function scheduleRetryAfter(
    payload: DeliverySendPayload,
    helpers: JobHelpers,
    retryAfterSec: number
): Promise<void> {
    const runAt = computeRetryAfterRunAt({
        nowMs: Date.now(),
        retryAfterSec,
        jitterMs: tuning.delivery.retryJitterMs
    });
    const remainingAttempts = Math.max(
        1,
        helpers.job.max_attempts - (helpers.job.attempts + 1)
    );
    await helpers.addJob(TASK_SEND, payload, {
        runAt,
        maxAttempts: remainingAttempts
    });
    logger.info(
        'delivery_job %d throttled — rescheduled for %s (retryAfter=%ds, remainingAttempts=%d)',
        payload.deliveryJobId,
        runAt.toISOString(),
        retryAfterSec,
        remainingAttempts
    );
}

export function computeRetryAfterRunAt(input: {
    nowMs: number;
    retryAfterSec: number;
    jitterMs: number;
    random?: () => number;
}): Date {
    const jitter = positiveJitterMs(
        input.jitterMs,
        input.random ?? Math.random
    );
    return new Date(input.nowMs + input.retryAfterSec * 1000 + jitter);
}

function positiveJitterMs(jitterMs: number, random: () => number): number {
    if (jitterMs <= 0) return 0;
    return Math.floor(Math.max(0, Math.min(1, random())) * jitterMs);
}

interface AdapterErrorFields {
    errorMessage: string;
    httpStatus?: number | null;
    retryAfterSec?: number | null;
    providerCode?: string | null;
}

// Pull retry/HTTP hints off any shape the adapter throws so
// scheduleRetryAfter() sees Retry-After even when wrapped in an Error.
function extractAdapterErrorFields(err: unknown): AdapterErrorFields {
    if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        const result: AdapterErrorFields = {
            errorMessage:
                err instanceof Error
                    ? (err.message ?? String(err))
                    : typeof e.errorMessage === 'string'
                      ? e.errorMessage
                      : String(err)
        };
        if (typeof e.httpStatus === 'number') result.httpStatus = e.httpStatus;
        if (typeof e.retryAfterSec === 'number') {
            result.retryAfterSec = e.retryAfterSec;
        }
        if (typeof e.providerCode === 'string') {
            result.providerCode = e.providerCode;
        }
        return result;
    }
    return {errorMessage: String(err)};
}

interface AdapterCall {
    adapter: NonNullable<ReturnType<typeof getAdapter>>;
    message: DeliveryPayload;
    context: DeliveryContext;
}

// The rule's template wins; otherwise fall back to the endpoint's own
// templateId. Resolved once per send through the shared cache.
async function effectiveTemplate(call: AdapterCall) {
    if (call.message.template) return call.message.template;
    const id = endpointTemplateId(call.context.config);
    if (id == null) return standardResolvedMessageTemplate();
    return (
        (await resolveMessageTemplate(call.context.organizationId, id)) ??
        standardResolvedMessageTemplate()
    );
}

async function runAdapter(call: AdapterCall): Promise<DeliveryResult> {
    try {
        // Render the applicable template once for this channel (single
        // authority); adapters read the rendered body off context.templateBody.
        const template = await effectiveTemplate(call);
        const prepared = prepareTemplatedSend(
            call.message,
            call.adapter.provider,
            template
        );
        call.context.templateBody = prepared.templateBody;
        return await call.adapter.send(prepared.message, call.context);
    } catch (err) {
        return {state: 'failed', ...extractAdapterErrorFields(err)};
    }
}

async function applyDeliveryRateLimit(input: {
    context: DeliveryContext;
    provider: ChannelProvider;
}): Promise<DeliveryResult | null> {
    const decision = await enforceDeliveryRateLimit(input);
    if (decision.allowed) return null;
    // A throttle is a "not now", not a failed send: defer fresh so it neither
    // consumes the retry budget nor records a failed attempt.
    return {
        state: 'failed',
        retryAfterSec: decision.retryAfterSec,
        errorMessage: `delivery rate limited: ${decision.reason}`,
        deferWithoutAttempt: true
    };
}

interface FinalizeInput {
    job: ClaimedJob;
    result: DeliveryResult;
    finalAttempt: boolean;
}

// Record attempt + notify. recordAttempt itself retries transient DB
// errors; if every retry fails and the adapter already delivered
// (succeeded), we swallow the throw here so graphile-worker doesn't
// retry → no double-send. The job will be reclaimed by the claim-TTL
// sweep if its DB state never caught up.
async function finalizeAttempt(
    input: FinalizeInput
): Promise<RecordedAttempt | undefined> {
    const {job, result, finalAttempt} = input;
    const final = result.state === 'succeeded' || finalAttempt;
    let attempt: RecordedAttempt | undefined;
    try {
        attempt = await recordDeliveryAttempt({
            jobId: job.id,
            result,
            final
        });
    } catch (err) {
        Observability.incrementCounter('outbox_record_attempt_errors');
        const succeeded = result.state === 'succeeded';
        logger[succeeded ? 'error' : 'warn'](
            'recordAttempt failed job=%d state=%s%s: %s',
            job.id,
            result.state,
            succeeded ? ' (suppressing retry to avoid double-send)' : '',
            formatError(err)
        );
        // Re-throwing would re-send; enqueue a record-only retry so the
        // 'succeeded' outcome lands without the reclaim cron mis-marking it.
        if (succeeded) await enqueueRecordReconcile(job, result);
    }
    try {
        emitDeliveryUpdated(
            job.organization_id,
            job.id,
            job.endpoint_id,
            attempt?.job_state ?? result.state
        );
    } catch (err) {
        logger.warn(
            'emitDeliveryUpdated failed job=%d: %s',
            job.id,
            formatError(err)
        );
    }
    if (attempt?.auto_disabled) {
        AlertEvents.emitEndpointAutoDisabled({
            organizationId: job.organization_id,
            endpointId: job.endpoint_id
        });
    }
    return attempt;
}

// Durable retry of a succeeded-but-unrecorded write. Record-only: the adapter
// already delivered, so it only moves 'processing' to 'succeeded', never resends.
async function enqueueRecordReconcile(
    job: ClaimedJob,
    result: DeliveryResult
): Promise<void> {
    if (!runner) {
        logger.error(
            'cannot reconcile succeeded job=%d — worker not running',
            job.id
        );
        return;
    }
    const payload: DeliveryRecordReconcilePayload = {
        deliveryJobId: job.id,
        organizationId: job.organization_id,
        endpointId: job.endpoint_id,
        httpStatus: result.httpStatus ?? null,
        providerCode: result.providerCode ?? null
    };
    try {
        await runner.addJob(TASK_RECORD_RECONCILE, payload, {
            maxAttempts: tuning.delivery.outboxRecordReconcileMaxAttempts
        });
    } catch (err) {
        // Enqueue itself failed (same DB). Loud: the row may strand and the
        // reclaim cron will mis-mark a real success as failed.
        Observability.incrementCounter(
            'outbox_record_reconcile_enqueue_errors'
        );
        logger.error(
            'failed to enqueue record-reconcile job=%d: %s',
            job.id,
            formatError(err)
        );
    }
}

// Re-write the 'succeeded' state for a delivery whose inline record failed.
// Throws so graphile-worker retries; never re-invokes the adapter.
async function reconcileRecord(
    payload: DeliveryRecordReconcilePayload
): Promise<void> {
    const attempt = await recordDeliveryAttempt({
        jobId: payload.deliveryJobId,
        result: {
            state: 'succeeded',
            httpStatus: payload.httpStatus ?? null,
            providerCode: payload.providerCode ?? null
        },
        final: true
    });
    Observability.incrementCounter('outbox_record_reconcile_recovered');
    emitDeliveryUpdated(
        payload.organizationId,
        payload.deliveryJobId,
        payload.endpointId,
        attempt?.job_state ?? 'succeeded'
    );
}

// Route a failed-not-final result onto the right retry path. Returns
// false if the caller should fall through to graphile-worker's backoff
// by throwing.
async function routeRetry(
    result: DeliveryResult,
    payload: DeliverySendPayload,
    helpers: JobHelpers
): Promise<boolean> {
    if (result.retryAfterSec && result.retryAfterSec > 0) {
        await scheduleRetryAfter(payload, helpers, result.retryAfterSec);
        return true;
    }
    return false;
}

async function quietHoursResumeAt(endpointId: number): Promise<Date | null> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_channel_quiet_hours_until',
        {p_endpoint_id: endpointId}
    );
    const row = res?.rows?.[0] as
        | {fn_channel_quiet_hours_until?: string | null}
        | undefined;
    const until = row?.fn_channel_quiet_hours_until;
    return typeof until === 'string' ? new Date(until) : null;
}

// Quiet hours suppress delivery without consuming retry budget: release the
// row to queued and schedule a FRESH job for when the window lifts, so a long
// window can never exhaust graphile's attempts and orphan the notification.
async function rescheduleAfterQuietHours(
    job: ClaimedJob,
    payload: DeliverySendPayload,
    helpers: JobHelpers
): Promise<void> {
    const resumeAt = await quietHoursResumeAt(job.endpoint_id);
    // Floor to a real minimum: a near-now or DST-ambiguous resume must not
    // spin (re-claim → still in quiet hours → reschedule) tighter than this.
    const earliest = Date.now() + tuning.delivery.rateRetryAfterSec * 1000;
    const runAt = new Date(Math.max(resumeAt?.getTime() ?? 0, earliest));
    // Schedule the future job BEFORE releasing: if the release then fails the
    // row stays 'processing' for the stranded-reclaim cron, never orphaned in
    // 'queued' with no worker pointing at it.
    await helpers.addJob(TASK_SEND, payload, {
        runAt,
        maxAttempts: helpers.job.max_attempts
    });
    await releaseJob(job.id);
    logger.info(
        'delivery_job %d in quiet hours — rescheduled for %s',
        job.id,
        runAt.toISOString()
    );
}

// Rate-limit deferral: like quiet hours, a throttle reschedules a FRESH job
// without consuming a retry attempt — so a sustained limit (or a Redis outage
// under fail-closed) defers the alert instead of dead-lettering it. Fresh job
// scheduled BEFORE releasing so a release failure leaves the row in
// 'processing' for the reclaim cron, never orphaned in 'queued'.
async function deferDelivery(
    job: ClaimedJob,
    payload: DeliverySendPayload,
    helpers: JobHelpers,
    result: DeliveryResult
): Promise<void> {
    const retryAfterSec =
        result.retryAfterSec && result.retryAfterSec > 0
            ? result.retryAfterSec
            : tuning.delivery.rateRetryAfterSec;
    const runAt = computeRetryAfterRunAt({
        nowMs: Date.now(),
        retryAfterSec,
        jitterMs: tuning.delivery.retryJitterMs
    });
    await helpers.addJob(TASK_SEND, payload, {
        runAt,
        maxAttempts: helpers.job.max_attempts
    });
    await releaseJob(job.id);
    logger.info(
        'delivery_job %d deferred (%s) — rescheduled for %s',
        job.id,
        result.errorMessage ?? 'rate limited',
        runAt.toISOString()
    );
}

async function processSendJob({
    payload,
    finalAttempt,
    helpers
}: ProcessJobInput): Promise<void> {
    const job = await claim(payload.deliveryJobId);
    if (!job) {
        logger.warn(
            'delivery_job %d missing or already claimed',
            payload.deliveryJobId
        );
        return;
    }
    if (await rejectIfEndpointUnavailable(job)) return;
    if (job.in_quiet_hours) {
        await rescheduleAfterQuietHours(job, payload, helpers);
        return;
    }
    const adapter = getAdapter(job.provider);
    if (!adapter) {
        await markJobFailed(
            job,
            `No adapter registered for provider ${job.provider}`
        );
        return;
    }
    const result = await executeDeliveryAttempt({
        job,
        adapter,
        message: payload.message
    });
    await handleDeliveryResult({
        job,
        result,
        payload,
        helpers,
        finalAttempt
    });
}

// A prepared send either carries the context to deliver with, or a terminal
// result that short-circuits the attempt (secret-decrypt failure, all
// recipients suppressed).
type PreparedDelivery =
    | {kind: 'deliver'; context: DeliveryContext}
    | {kind: 'short_circuit'; result: DeliveryResult};

// Build the context, converting a secret-decrypt failure into a retryable
// result so the adapter is never reached without the credential it needs.
async function buildContextOrFail(job: ClaimedJob): Promise<PreparedDelivery> {
    try {
        return {kind: 'deliver', context: await buildDeliveryContext(job)};
    } catch (err) {
        if (err instanceof SecretsUnavailableError) {
            return {
                kind: 'short_circuit',
                result: {state: 'failed', errorMessage: err.message}
            };
        }
        throw err;
    }
}

// Drop suppressed email recipients. When every one is suppressed the job is a
// no-op success — not a failure that would retry and count toward auto-disable.
async function applyEmailSuppressionNoOp(
    job: ClaimedJob,
    context: DeliveryContext
): Promise<PreparedDelivery> {
    const suppression = await applyEmailRecipientSuppressions(context);
    if (!suppression.allRecipientsSuppressed) {
        return {kind: 'deliver', context: suppression.context};
    }
    logger.info(
        'delivery_job %d — all %d recipient(s) suppressed; nothing to send',
        job.id,
        suppression.suppressedRecipients.length
    );
    return {
        kind: 'short_circuit',
        result: {state: 'succeeded', providerCode: null}
    };
}

// Builds the per-job context, applies email suppressions + rate limit, and
// invokes the adapter. ANSWER-only — no DB writes or job state changes.
async function executeDeliveryAttempt(args: {
    job: ClaimedJob;
    adapter: NonNullable<ReturnType<typeof getAdapter>>;
    message: DeliveryPayload;
}): Promise<DeliveryResult> {
    const built = await buildContextOrFail(args.job);
    if (built.kind === 'short_circuit') return built.result;
    const prepared =
        args.job.provider === 'email_smtp'
            ? await applyEmailSuppressionNoOp(args.job, built.context)
            : built;
    if (prepared.kind === 'short_circuit') return prepared.result;
    return (
        (await applyDeliveryRateLimit({
            context: prepared.context,
            provider: args.job.provider
        })) ??
        (await runAdapter({
            adapter: args.adapter,
            message: args.message,
            context: prepared.context
        }))
    );
}

// Decides whether to finalize or route a retry, then persists the attempt
// row. Throws on retryable failures so graphile-worker reschedules.
async function handleDeliveryResult(args: {
    job: ClaimedJob;
    result: DeliveryResult;
    payload: ProcessJobInput['payload'];
    helpers: JobHelpers;
    finalAttempt: boolean;
}): Promise<void> {
    if (args.result.deferWithoutAttempt) {
        await deferDelivery(args.job, args.payload, args.helpers, args.result);
        return;
    }
    await recordRecipientAudit(args.job, args.payload.message, args.result);
    const failure = classifyDeliveryFailure(args.result);
    const shouldFinalize =
        args.finalAttempt ||
        (args.result.state === 'failed' && failure.kind === 'permanent');
    await finalizeAttempt({
        job: args.job,
        result: args.result,
        finalAttempt: shouldFinalize
    });
    if (args.result.state === 'failed' && !shouldFinalize) {
        if (await routeRetry(args.result, args.payload, args.helpers)) return;
        throw new Error(args.result.errorMessage ?? 'delivery failed');
    }
}

// Strategy maps — no switch in business logic.
const CHANNEL_KIND_BY_PROVIDER: Record<
    ChannelProvider,
    DeliveryAuditChannelKind
> = {
    email_smtp: 'email',
    generic_webhook: 'webhook',
    slack_webhook: 'slack',
    teams_workflow_webhook: 'teams',
    telegram_bot: 'telegram',
    push_fcm: 'push',
    sms_twilio: 'sms',
    voice_twilio: 'voice',
    webhook_signed: 'webhook'
};

const RECIPIENT_CONFIG_KEY_BY_PROVIDER: Record<ChannelProvider, string> = {
    email_smtp: 'to',
    generic_webhook: 'url',
    slack_webhook: 'url',
    teams_workflow_webhook: 'url',
    telegram_bot: 'chatId',
    push_fcm: 'token',
    sms_twilio: 'to',
    voice_twilio: 'to',
    webhook_signed: 'url'
};

const AUDIT_OUTCOME_BY_DELIVERY_STATE: Record<
    DeliveryResult['state'],
    DeliveryAuditOutcome
> = {
    succeeded: 'sent',
    failed: 'failed'
};

// Adapter: PostgresProvider.queryRows → PgClientLike shape. The audit
// class wants `query(sql, values) → {rows}`; queryRows returns rows[]
// directly.
const auditPgClient = {
    async query<R>(sql: string, values?: ReadonlyArray<unknown>) {
        const rows = await PostgresProvider.queryRows<R>(sql, values ?? []);
        return {rows};
    }
};
const auditRecorder = new DeliveryRecipientAudit(auditPgClient);

function providerToChannelKind(
    provider: ChannelProvider
): DeliveryAuditChannelKind {
    return CHANNEL_KIND_BY_PROVIDER[provider];
}

function extractRecipient(
    provider: ChannelProvider,
    config: Record<string, unknown>
): string {
    const key = RECIPIENT_CONFIG_KEY_BY_PROVIDER[provider];
    const v = config[key];
    return typeof v === 'string' ? v : '';
}

function outcomeFromResult(result: DeliveryResult): DeliveryAuditOutcome {
    return AUDIT_OUTCOME_BY_DELIVERY_STATE[result.state];
}

function severityForAudit(
    message: DeliveryPayload
): 'critical' | 'warning' | 'info' | null {
    const s = message.severity;
    return s === 'critical' || s === 'warning' || s === 'info' ? s : null;
}

function buildAuditRecord(
    job: ClaimedJob,
    message: DeliveryPayload,
    result: DeliveryResult
) {
    return {
        organizationId: job.organization_id,
        channelKind: providerToChannelKind(job.provider),
        recipient: extractRecipient(job.provider, job.endpoint_config),
        outcome: outcomeFromResult(result),
        alertId: message.alertId ?? null,
        ruleId: message.ruleId ?? null,
        channelId: job.endpoint_id,
        provider: job.provider,
        providerMessageId: result.providerCode ?? null,
        errorCode: result.errorMessage ? String(result.httpStatus ?? '') : null,
        severity: severityForAudit(message)
    };
}

// GDPR audit trail — recipient-hash keyed (migration 6534).
async function recordRecipientAudit(
    job: ClaimedJob,
    message: DeliveryPayload,
    result: DeliveryResult
): Promise<void> {
    await safeRecordAudit(buildAuditRecord(job, message, result));
}

async function safeRecordAudit(
    record: ReturnType<typeof buildAuditRecord>
): Promise<void> {
    try {
        await auditRecorder.record(record);
    } catch (err) {
        logger.warn(
            'delivery audit record failed (continuing): %s',
            formatError(err)
        );
    }
}

export async function __processSendJobForTests(
    input: Omit<ProcessJobInput, 'helpers'> & {helpers?: Partial<JobHelpers>}
): Promise<void> {
    await processSendJob({
        payload: input.payload,
        finalAttempt: input.finalAttempt,
        helpers: (input.helpers ?? {}) as JobHelpers
    });
}

export async function __reclaimStrandedJobsForTests(): Promise<number> {
    return reclaimStrandedJobs({requireLeadership: false});
}

// Inject a minimal runner so a test can observe enqueue() without a real
// graphile-worker. Pass undefined to clear.
export function __setRunnerForTests(
    fake: Pick<Runner, 'addJob'> | undefined
): void {
    runner = (fake as Runner) ?? null;
}

// The real state-hold task, so an integration test can run it on a real
// graphile-worker runner and prove enqueue → schedule → fire end to end.
export function __stateHoldTaskListForTests(): TaskList {
    return {[TASK_STATE_HOLD]: runStateHoldTask};
}

export async function __reconcileRecordForTests(
    payload: DeliveryRecordReconcilePayload
): Promise<void> {
    await reconcileRecord(payload);
}

export async function __flushNotificationDigestsForTests(): Promise<void> {
    await flushNotificationDigests({requireLeadership: false});
}
