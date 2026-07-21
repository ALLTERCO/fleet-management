// AlertEngine — rule eval + instance upsert + inbox/delivery fan-out + WS emit.
// Rule cache is per-org, invalidated by Rule mutation events.

import * as log4js from 'log4js';
import {tuning} from '../config';
import {groupPolicy} from '../config/groupPolicy';
import type AbstractDevice from '../model/AbstractDevice';
import CommandSender from '../model/CommandSender';
import {
    ALERT_RULE_KIND_DESCRIPTOR_BY_KEY,
    type AlertRuleKind,
    type AlertSeverity,
    publicAlertRuleKind,
    storedAlertRuleKind
} from '../types/api/alert';
import * as AlertEvents from './AlertEvents';
import {registerOrganizationRuleEvaluator} from './alert/evaluationPort';
import {getEvaluator, registeredKinds} from './alert/evaluators';
import {
    collectLeafRuleIds,
    evaluateComposite,
    hydrateTree,
    type LeafState,
    readCompositeTree,
    synthesizeCompositeHit
} from './alert/evaluators/composite';
import {buildDeviceOfflineMatch} from './alert/evaluators/deviceOffline';
import {motionClearTimeoutSec} from './alert/evaluators/motionDetected';
import {fieldFingerprintV2} from './alert/fingerprint';
import {
    canonicalAlertFingerprint,
    canonicalizeAlertMatch,
    findCurrentDeviceExternalId,
    type LogicalDeviceHint,
    resolveLogicalDeviceId
} from './alert/logicalDeviceFingerprint';
import {
    clearNotifiedFallback,
    getNotifiedFallbackMs,
    recordNotifiedFallback
} from './alert/notifiedFallback';
import {type RuleRowShape, rowToLoadedRule} from './alert/ruleRow';
import {hydratePublicRuleScopes} from './alert/ruleScopePersistence';
import {matchesScope} from './alert/scope';
import {resolveSubjectForEvent} from './alert/subjectForEvent';
import {renderTemplate} from './alert/templateRenderer';
import type {
    Evaluator,
    LoadedAlertRule,
    MatchResult,
    NormalizedEvent
} from './alert/types';
import {BoundedMap} from './boundedMap';
import * as DeviceCollector from './DeviceCollector';
import * as OutboxWorker from './delivery/OutboxWorker';
import type {DeliveryPayload, ResolvedMessageTemplate} from './delivery/types';
import * as EventDistributor from './EventDistributor';
import {describeError} from './errorDescription';
import {buildAlertPayload} from './notification/AlertPayloadBuilder';
import {resolveMessageTemplate} from './notification/messageTemplateResolver';
import {
    abortDeliveryJobSafely,
    type DeliveryJobReference,
    routeAlertNotification,
    routeEscalationStageNotification
} from './notification/NotificationRouter';
import {
    invalidateOrganizationRecipientUsers,
    invalidateRuleRecipientUsers,
    resolveInboxRecipientUsersByMode
} from './notification/RecipientResolver';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';
import * as ShellyEvents from './ShellyEvents';
import {SingleFlight} from './singleFlight';
import {runBoundedParallel} from './util/runBoundedParallel';
import {sleep} from './util/sleep';
import {withTimeout} from './util/withTimeout';
import {enrichVirtualAlertMatch} from './virtualDeviceAlerts';

const logger = log4js.getLogger('AlertEngine');

// Fired without await — log, don't let it escape.
const logIngestError = (err: unknown): void =>
    logger.error('alert ingest failed: %s', err);

// --- Rule cache ----------------------------------------------------------

// FM_ALERT_RULES_CACHE_MAX / FM_ALERT_RULES_CACHE_TTL_MS.
const rulesByOrg = new BoundedMap<string, LoadedAlertRule[]>({
    maxSize: tuning.alert.rulesCacheMax,
    ttlMs: tuning.alert.rulesCacheTtlMs
});

async function loadRulesForOrg(
    organizationId: string
): Promise<LoadedAlertRule[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_rule_list_enabled',
        {p_organization_id: organizationId}
    );
    const rows = (result?.rows ?? []) as RuleRowShape[];
    await hydratePublicRuleScopes(organizationId, rows);
    return rows.map(rowToLoadedRule);
}

const rulesInflight = new SingleFlight<string, LoadedAlertRule[]>(
    'alert_rules'
);

async function rulesFor(organizationId: string): Promise<LoadedAlertRule[]> {
    const cached = rulesByOrg.get(organizationId);
    if (cached) return cached;
    return rulesInflight.run(organizationId, async () => {
        const loaded = await loadRulesForOrg(organizationId);
        rulesByOrg.set(organizationId, loaded);
        return loaded;
    });
}

/** Call when a rule changes — Rule.Create / Rule.Update / Rule.Delete. */
export function invalidateRuleCache(organizationId: string): void {
    rulesByOrg.delete(organizationId);
}

// Call when destination groups for a rule may have changed.
export function invalidateRecipientsCache(
    organizationId: string,
    ruleId?: number
): void {
    if (ruleId !== undefined) {
        invalidateRuleRecipientUsers({organizationId, ruleId});
        return;
    }
    invalidateOrganizationRecipientUsers(organizationId);
}

// --- Upsert + inbox + WS -------------------------------------------------

interface UpsertedInstance {
    id: number;
    organization_id: string;
    rule_id: number;
    rule_kind: AlertRuleKind;
    state: string;
    severity: AlertSeverity;
    source_subject_type: string;
    source_subject_id: string;
    title: string;
    message: string;
    fingerprint: string;
    context: Record<string, unknown> | null;
    active_since: string;
    last_triggered_at: string;
    last_notified_at?: string | null;
    silenced_until?: string | null;
    was_created: boolean;
    changed: boolean;
}

// Only an explicit changed=false suppresses — absent (pre-6936 row shape)
// fails open to the emit.
function rowChanged(instance: UpsertedInstance): boolean {
    return instance.changed !== false;
}

type EvaluationInstanceState =
    | 'pending'
    | 'recovering'
    | 'no_data'
    | 'evaluation_error';

async function upsertInstance(
    rule: LoadedAlertRule,
    match: MatchResult,
    isCanonical = false,
    device?: LogicalDeviceHint
): Promise<UpsertedInstance | undefined> {
    const persistedMatch = isCanonical
        ? match
        : await canonicalizeAlertMatch(
              rule.organizationId,
              rule.id,
              match,
              device
          );
    const policy = groupPolicy();
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_upsert',
        {
            p_organization_id: rule.organizationId,
            p_rule_id: rule.id,
            p_rule_kind: storedAlertRuleKind(rule.kind),
            p_severity: persistedMatch.severity ?? rule.severity,
            p_subject_type: persistedMatch.subject.type,
            p_subject_id: persistedMatch.subject.id,
            p_title: persistedMatch.title,
            p_message: persistedMatch.message,
            p_fingerprint_v2: persistedMatch.fingerprintV2,
            p_context: JSON.stringify(persistedMatch.context ?? {}),
            p_default_floor_standard: policy.severityFloorByType.standard,
            p_default_floor_operational: policy.severityFloorByType.operational,
            p_default_floor_critical: policy.severityFloorByType.critical,
            p_default_floor_custom: policy.severityFloorByType.custom,
            p_dedupe_window_sec: rule.dedupeWindowSec
        }
    );
    return result?.rows?.[0] as UpsertedInstance | undefined;
}

export async function markEvaluationState(
    rule: LoadedAlertRule,
    match: MatchResult,
    state: EvaluationInstanceState,
    isCanonical = false,
    device?: LogicalDeviceHint
): Promise<UpsertedInstance | undefined> {
    const persistedMatch = isCanonical
        ? match
        : await canonicalizeAlertMatch(
              rule.organizationId,
              rule.id,
              match,
              device
          );
    const policy = groupPolicy();
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_mark_evaluation_state',
        {
            p_organization_id: rule.organizationId,
            p_rule_id: rule.id,
            p_rule_kind: storedAlertRuleKind(rule.kind),
            p_state: state,
            p_severity: persistedMatch.severity ?? rule.severity,
            p_subject_type: persistedMatch.subject.type,
            p_subject_id: persistedMatch.subject.id,
            p_title: persistedMatch.title,
            p_message: persistedMatch.message,
            p_fingerprint_v2: persistedMatch.fingerprintV2,
            p_context: JSON.stringify({
                ...(persistedMatch.context ?? {}),
                lifecycleState: state
            }),
            p_default_floor_standard: policy.severityFloorByType.standard,
            p_default_floor_operational: policy.severityFloorByType.operational,
            p_default_floor_critical: policy.severityFloorByType.critical,
            p_default_floor_custom: policy.severityFloorByType.custom
        }
    );
    const instance = result?.rows?.[0] as UpsertedInstance | undefined;
    if (!instance) return undefined;
    if (rowChanged(instance)) {
        emitAlertWs(
            instance.was_created ? 'Alert.Created' : 'Alert.Updated',
            instance
        );
    }
    return instance;
}

interface InsertedInboxItem {
    id: number;
    organization_id: string;
    user_id: string;
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved' | 'alert_digest';
    state: 'unread' | 'read';
    alert_id: number | null;
}

async function addInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved'
): Promise<void> {
    const users = await resolveInboxRecipientUsersByMode({
        organizationId: rule.organizationId,
        ruleId: rule.id,
        severity: instance.severity
    });
    // rule.deliveryMode='digest' forces every recipient into the digest
    // queue, overriding per-user preference.
    if (rule.deliveryMode === 'digest') {
        const allUserIds = [...users.immediateUserIds, ...users.digestUserIds];
        await queueDigestInboxItems(rule, instance, kind, allUserIds);
        return;
    }
    await addImmediateInboxItems(rule, instance, kind, users.immediateUserIds);
    await queueDigestInboxItems(rule, instance, kind, users.digestUserIds);
}

async function addImmediateInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved',
    userIds: string[]
): Promise<void> {
    if (userIds.length === 0) return;
    const result = await PostgresProvider.callMethod(
        'notifications.fn_notification_inbox_add_batch',
        {
            p_organization_id: rule.organizationId,
            p_user_ids: userIds,
            p_kind: kind,
            p_alert_id: instance.id,
            p_subject_type: instance.source_subject_type,
            p_subject_id: instance.source_subject_id,
            p_title: instance.title,
            p_message: instance.message,
            p_available_actions: JSON.stringify([])
        }
    );
    const inserted = (result?.rows ?? []) as InsertedInboxItem[];
    emitInsertedInboxItems(inserted);
}

async function queueDigestInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved',
    userIds: string[]
): Promise<void> {
    if (userIds.length === 0) return;
    await PostgresProvider.callMethod(
        'notifications.fn_notification_digest_queue_add_batch',
        {
            p_organization_id: rule.organizationId,
            p_user_ids: userIds,
            p_kind: kind,
            p_alert_id: instance.id,
            p_subject_type: instance.source_subject_type,
            p_subject_id: instance.source_subject_id,
            p_title: instance.title,
            p_message: instance.message,
            p_severity: instance.severity,
            p_flush_after: new Date(
                Date.now() + tuning.delivery.digestDefaultDelayMinutes * 60_000
            )
        }
    );
}

function emitInsertedInboxItems(inserted: InsertedInboxItem[]): void {
    for (const row of inserted) {
        AlertEvents.emitNotificationCreated({
            organizationId: row.organization_id,
            userId: row.user_id,
            notificationId: row.id,
            alertId: row.alert_id ?? undefined,
            kind: row.kind
        });
    }
}

async function handleDigestFlush(): Promise<void> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_notification_digest_flush_due',
        {p_limit: tuning.alert.groupMaxMembers}
    );
    emitInsertedInboxItems((result?.rows ?? []) as InsertedInboxItem[]);
}

function emitAlertWs(
    method: 'Alert.Created' | 'Alert.Updated' | 'Alert.Resolved',
    instance: UpsertedInstance
): void {
    const params: AlertEvents.AlertWsParams = {
        organizationId: instance.organization_id,
        alertId: instance.id,
        ruleId: instance.rule_id,
        ruleKind: publicAlertRuleKind(instance.rule_kind),
        state: instance.state,
        severity: instance.severity
    };
    if (method === 'Alert.Created') AlertEvents.emitAlertCreated(params);
    else if (method === 'Alert.Updated') AlertEvents.emitAlertUpdated(params);
    else AlertEvents.emitAlertResolved(params);
}

// --- Event ingestion -----------------------------------------------------

async function subjectForEvent(event: NormalizedEvent) {
    return resolveSubjectForEvent(event, PostgresProvider.callMethod);
}

async function logicalDeviceHint(input: {
    organizationId: string;
    externalId: string;
    device?: AbstractDevice;
}): Promise<LogicalDeviceHint> {
    const deviceId =
        input.device && Number.isInteger(input.device.id) && input.device.id > 0
            ? input.device.id
            : await resolveLogicalDeviceId(
                  input.organizationId,
                  input.externalId
              );
    return {deviceId, externalId: input.externalId};
}

async function onTrigger(
    rule: LoadedAlertRule,
    evaluator: Evaluator,
    event: NormalizedEvent
): Promise<void> {
    const device =
        'shellyID' in event
            ? await logicalDeviceHint({
                  organizationId: event.organizationId,
                  externalId: event.shellyID,
                  device: 'device' in event ? event.device : undefined
              })
            : undefined;
    for (const match of await collectMatches(rule, evaluator, event)) {
        if (await maybeDeferOfflineFire(rule, event, match, device)) continue;
        if (await maybeScheduleStateHold(rule, match, device)) continue;
        await fireMatch(rule, match, false, device);
    }
}

// One or many matches: composite synthesizes one; matchAll fans out per
// subject (watch-all); otherwise the single match path.
async function collectMatches(
    rule: LoadedAlertRule,
    evaluator: Evaluator,
    event: NormalizedEvent
): Promise<MatchResult[]> {
    if (rule.kind === 'composite') {
        const m = await evaluateCompositeRule(rule, event);
        return m ? [m] : [];
    }
    if (evaluator.matchAll) return evaluator.matchAll(event, rule);
    const m = evaluator.match(event, rule);
    return m ? [m] : [];
}

async function evaluateCompositeRule(
    rule: LoadedAlertRule,
    event: NormalizedEvent
): Promise<MatchResult | null> {
    if (event.kind !== 'device_status_changed') return null;
    const tree = readCompositeTree(rule.config);
    if (!tree) return null;
    const leafIds = collectLeafRuleIds(tree);
    if (leafIds.length === 0) return null;
    const deviceId = await resolveLogicalDeviceId(
        event.organizationId,
        event.shellyID
    );
    const {rows} = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_states_for_rules',
        {
            p_organization_id: event.organizationId,
            p_rule_ids: leafIds,
            p_subject_type: 'device',
            p_subject_id: String(deviceId)
        }
    );
    const states = new Map<number, LeafState>();
    for (const raw of rows ?? []) {
        const r = raw as {rule_id?: number; active_since?: string};
        if (typeof r.rule_id !== 'number' || !r.active_since) continue;
        states.set(r.rule_id, {
            ruleId: r.rule_id,
            activeSinceMs: new Date(r.active_since).getTime()
        });
    }
    const hydrated = hydrateTree(tree, states);
    const evaluation = evaluateComposite(hydrated, Date.now());
    if (!evaluation.matched) return null;
    return synthesizeCompositeHit({
        ruleId: rule.id,
        ruleName: rule.name,
        subjectType: 'device',
        subjectId: event.shellyID,
        evaluation
    });
}

// RuleSweep entry: a timer-synthesized match takes the same fire path as an
// event-driven one, so sweep alerts behave identically downstream.
export async function ingestSweepMatch(
    rule: LoadedAlertRule,
    match: MatchResult
): Promise<void> {
    await fireMatch(rule, match, true);
}

/** Enabled rules for an org (cached) — exposed for the RuleSweep. */
export async function sweepRulesFor(
    organizationId: string
): Promise<LoadedAlertRule[]> {
    return rulesFor(organizationId);
}

export function scheduleInitialRuleEvaluation(input: {
    organizationId: string;
    ruleId: number;
    reason: 'create' | 'enable' | 'update';
}): void {
    setImmediate(() => {
        void evaluateInitialRule(input).catch((err) => {
            Observability.incrementCounter('alert_initial_eval_failed');
            logger.error(
                'initial alert evaluation failed org=%s rule=%d reason=%s: %s',
                input.organizationId,
                input.ruleId,
                input.reason,
                String(err)
            );
        });
    });
}

// K device admissions fire K scope_changed requests. A queued or in-flight
// org run absorbs them; a request landing mid-run books ONE trailing rerun,
// so post-run state is never stale. SingleFlight tracks the in-flight run.
const orgEvalInflight = new SingleFlight<string, void>('alert_org_eval');
const orgEvalQueued = new Set<string>();
const orgEvalRerunPending = new Set<string>();

export function scheduleOrganizationRuleEvaluation(input: {
    organizationId: string;
    reason: 'scope_changed' | 'startup';
}): void {
    const org = input.organizationId;
    if (orgEvalQueued.has(org)) {
        Observability.incrementCounter('alert_org_eval_coalesced');
        return;
    }
    if (orgEvalInflight.peek(org)) {
        Observability.incrementCounter('alert_org_eval_coalesced');
        orgEvalRerunPending.add(org);
        return;
    }
    orgEvalQueued.add(org);
    setImmediate(() => {
        orgEvalQueued.delete(org);
        void runCoalescedOrgEvaluation(input).catch((err) => {
            if (isPostgresNotReady(err)) {
                logger.debug(
                    'organization alert evaluation skipped org=%s reason=%s: postgres not ready',
                    input.organizationId,
                    input.reason
                );
                return;
            }
            Observability.incrementCounter('alert_org_eval_failed');
            logger.error(
                'organization alert evaluation failed org=%s reason=%s: %s',
                input.organizationId,
                input.reason,
                String(err)
            );
        });
    });
}

async function runCoalescedOrgEvaluation(input: {
    organizationId: string;
    reason: 'scope_changed' | 'startup';
}): Promise<void> {
    try {
        await orgEvalInflight.run(input.organizationId, () =>
            evaluateInitialRulesForOrg(input)
        );
    } finally {
        if (orgEvalRerunPending.delete(input.organizationId)) {
            scheduleOrganizationRuleEvaluation(input);
        }
    }
}

registerOrganizationRuleEvaluator(scheduleOrganizationRuleEvaluation);

function isPostgresNotReady(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return (
        message.includes('Database not ready') ||
        message.includes('callMethod called with no db stub')
    );
}

async function evaluateInitialRulesForOrg(input: {
    organizationId: string;
    reason: 'scope_changed' | 'startup';
}): Promise<void> {
    for (const rule of await rulesFor(input.organizationId)) {
        await evaluateLoadedRuleInitialIsolated(rule);
    }
}

// One failing rule must not abort the rest of the org rerun; DB-down still does.
async function evaluateLoadedRuleInitialIsolated(
    rule: LoadedAlertRule
): Promise<void> {
    try {
        await evaluateLoadedRuleInitial(rule);
    } catch (err) {
        if (isPostgresNotReady(err)) throw err;
        Observability.incrementCounter('alert_org_eval_rule_failed');
        logger.error(
            'initial evaluation failed rule=%d (%s): %s',
            rule.id,
            rule.kind,
            String(err)
        );
    }
}

export async function evaluateInitialRule(input: {
    organizationId: string;
    ruleId: number;
    reason: 'create' | 'enable' | 'update' | 'test';
}): Promise<void> {
    const rule =
        (await rulesFor(input.organizationId)).find(
            (r) => r.id === input.ruleId
        ) ?? null;
    if (!rule) return;
    await evaluateLoadedRuleInitial(rule);
}

async function evaluateLoadedRuleInitial(rule: LoadedAlertRule): Promise<void> {
    const descriptor = ALERT_RULE_KIND_DESCRIPTOR_BY_KEY[rule.kind];
    if (!descriptor?.initialEvaluation) return;

    if (
        descriptor.evaluationMode === 'state' ||
        descriptor.evaluationMode === 'composite'
    ) {
        await evaluateCurrentStatusRule(rule);
        return;
    }

    if (
        descriptor.evaluationMode === 'absence' ||
        descriptor.evaluationMode === 'window'
    ) {
        const sweep = await import('./alert/RuleSweep.js');
        await sweep.runSweepForRules(rule.organizationId, Date.now(), [
            rule.id
        ]);
    }
}

async function evaluateCurrentStatusRule(rule: LoadedAlertRule): Promise<void> {
    const evaluator = getEvaluator(rule.kind);
    if (!evaluator?.triggerKinds.includes('device_status_changed')) return;

    const seen = new Set<string>();
    for (const device of DeviceCollector.getAll()) {
        if (
            EventDistributor.getDeviceOrg(device.shellyID) !==
            rule.organizationId
        ) {
            continue;
        }
        seen.add(device.shellyID);
        const event: NormalizedEvent = {
            kind: 'device_status_changed',
            organizationId: rule.organizationId,
            shellyID: device.shellyID,
            status: (device.status ?? {}) as Record<string, unknown>,
            device
        };
        const hint = await logicalDeviceHint({
            organizationId: rule.organizationId,
            externalId: device.shellyID,
            device
        });
        await resolveFingerprint(
            rule,
            noDataMatchForRule(rule, device.shellyID, {}).fingerprintV2,
            hint
        );
        const subject = await subjectForEvent(event);
        if (!matchesScope(rule.scope, subject)) continue;
        const matches = await collectMatches(rule, evaluator, event);
        if (matches.length > 0) {
            for (const match of matches) {
                if (await maybeScheduleStateHold(rule, match, hint)) continue;
                await fireMatch(rule, match, false, hint);
            }
            continue;
        }
        if (evaluator.clearKinds?.includes('device_status_changed')) {
            await onClear(rule, evaluator, event);
        }
    }

    for (const row of await storedDeviceSnapshots(rule.organizationId)) {
        if (seen.has(row.external_id)) continue;
        const snapshot = deviceSnapshotFromStoredRow(row);
        const hint = {deviceId: row.id, externalId: row.external_id};
        const status = snapshot.status;
        const event: NormalizedEvent = {
            kind: 'device_status_changed',
            organizationId: rule.organizationId,
            shellyID: row.external_id,
            status,
            device: snapshot
        };
        const subject = await subjectForEvent(event);
        if (!matchesScope(rule.scope, subject)) continue;
        if (!status || Object.keys(status).length === 0) {
            await markEvaluationState(
                rule,
                noDataMatchForRule(rule, row.external_id, {
                    reason: 'missing_latest_status',
                    source: 'device.list'
                }),
                'no_data',
                false,
                hint
            );
            continue;
        }
        await resolveFingerprint(
            rule,
            noDataMatchForRule(rule, row.external_id, {}).fingerprintV2,
            hint
        );
        const matches = await collectMatches(rule, evaluator, event);
        if (matches.length > 0) {
            for (const match of matches) {
                if (await maybeScheduleStateHold(rule, match, hint)) continue;
                await fireMatch(rule, match, false, hint);
            }
            continue;
        }
        if (evaluator.clearKinds?.includes('device_status_changed')) {
            await onClear(rule, evaluator, event);
        }
    }
}

interface StoredDeviceSnapshotRow {
    id: number;
    external_id: string;
    jdoc: Record<string, unknown> | null;
}

async function storedDeviceSnapshots(
    organizationId: string
): Promise<StoredDeviceSnapshotRow[]> {
    return PostgresProvider.queryRows<StoredDeviceSnapshotRow>(
        `SELECT id, external_id, jdoc
           FROM device.list
          WHERE organization_id = $1
            AND external_id IS NOT NULL`,
        [organizationId]
    );
}

function deviceSnapshotFromStoredRow(
    row: StoredDeviceSnapshotRow
): AbstractDevice {
    const jdoc =
        row.jdoc && typeof row.jdoc === 'object' && !Array.isArray(row.jdoc)
            ? row.jdoc
            : {};
    return {
        ...jdoc,
        id: row.id,
        shellyID: row.external_id,
        status:
            jdoc.status &&
            typeof jdoc.status === 'object' &&
            !Array.isArray(jdoc.status)
                ? (jdoc.status as Record<string, unknown>)
                : {},
        info:
            jdoc.info &&
            typeof jdoc.info === 'object' &&
            !Array.isArray(jdoc.info)
                ? jdoc.info
                : {},
        entities: Array.isArray(jdoc.entities) ? jdoc.entities : []
    } as unknown as AbstractDevice;
}

function noDataMatchForRule(
    rule: LoadedAlertRule,
    shellyID: string,
    context: Record<string, unknown>
): MatchResult {
    return {
        fingerprintV2: `rule:${rule.id}:device:${shellyID}:no_data`,
        title: `${shellyID} has no data`,
        message: `Rule "${rule.name}" could not evaluate because required data is missing.`,
        subject: {type: 'device', id: shellyID},
        context: {shellyID, ...context}
    };
}

async function fireMatch(
    rule: LoadedAlertRule,
    match: MatchResult,
    isCanonical = false,
    device?: LogicalDeviceHint
): Promise<void> {
    const enrichedMatch = await enrichVirtualAlertMatch(
        rule.organizationId,
        match
    );
    const templatedMatch = applyRuleTemplates(rule, enrichedMatch);
    const instance = await upsertInstance(
        rule,
        templatedMatch,
        isCanonical,
        device
    );
    if (!instance) return;
    // Unchanged re-fire: no inbox add, no WS emit. Delivery stays
    // cooldown-gated below — re-notification semantics are untouched.
    const changed = rowChanged(instance);
    if (changed) {
        const kind = instance.was_created ? 'alert_created' : 'alert_updated';
        await addInboxItems(rule, instance, kind);
    }
    if (
        shouldDeliverAfterCooldown(
            rule,
            instance,
            getNotifiedFallbackMs(instance.id)
        )
    ) {
        await routeAlertNotification({rule, instance});
        await recordNotified(instance.id);
    } else {
        Observability.incrementCounter('alert_delivery_suppressed_by_cooldown');
    }
    if (changed) {
        emitAlertWs(
            instance.was_created ? 'Alert.Created' : 'Alert.Updated',
            instance
        );
    }
    await scheduleMotionClearIfApplicable(rule, match.fingerprintV2);
}

// rule.summaryTemplate / messageTemplate, when present, drive the
// STORED alert title/message via the upsert. The same context is reused
// downstream by the delivery renderer so the inbox shows the same text
// every channel does.
export function applyRuleTemplates(
    rule: LoadedAlertRule,
    match: MatchResult
): MatchResult {
    if (!rule.summaryTemplate && !rule.messageTemplate) return match;
    const ctx = {
        alert: {
            id: 0,
            title: match.title,
            message: match.message,
            severity: match.severity ?? rule.severity,
            state: 'active',
            source: {
                type: match.subject.type,
                id: match.subject.id
            },
            firedAt: '',
            activeSince: ''
        },
        rule: {
            id: rule.id,
            name: rule.name,
            kind: rule.kind,
            runbookUrl: rule.runbookUrl
        },
        context: match.context ?? {},
        labels: {}
    };
    const title = rule.summaryTemplate
        ? renderTemplate(rule.summaryTemplate, ctx).rendered || match.title
        : match.title;
    const message = rule.messageTemplate
        ? renderTemplate(rule.messageTemplate, ctx).rendered || match.message
        : match.message;
    return {...match, title, message};
}

// First fire always notifies. Re-fires notify only when cooldownSec has
// elapsed since last_notified_at — history records material changes only
// (7313): an identical re-fire bumps last_triggered_at without a row.
// fallbackMs covers the window where the DB write of last_notified_at
// failed: an in-memory delivery time still gates the cooldown.
export function shouldDeliverAfterCooldown(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    fallbackMs?: number
): boolean {
    if (instance.was_created) return true;
    if (rule.cooldownSec <= 0) return true;
    const dbLast = instance.last_notified_at
        ? new Date(instance.last_notified_at).getTime()
        : 0;
    const last = Math.max(
        Number.isFinite(dbLast) ? dbLast : 0,
        fallbackMs ?? 0
    );
    if (last === 0) return true;
    return Date.now() - last >= rule.cooldownSec * 1000;
}

// last_notified_at gates cooldown — retry a blip so a re-fire doesn't
// re-notify; count a persistent failure.
const RECORD_NOTIFIED_ATTEMPTS = 3;
const RECORD_NOTIFIED_BACKOFF_MS = 100;

async function recordNotified(instanceId: number): Promise<void> {
    for (let attempt = 1; attempt <= RECORD_NOTIFIED_ATTEMPTS; attempt++) {
        try {
            await PostgresProvider.callMethod(
                'notifications.fn_alert_instance_record_notification',
                {p_id: instanceId}
            );
            // DB is authoritative now — drop any stale in-memory fallback.
            clearNotifiedFallback(instanceId);
            return;
        } catch (err) {
            if (attempt === RECORD_NOTIFIED_ATTEMPTS) {
                Observability.incrementCounter('alert_record_notified_errors');
                logger.error(
                    'fn_alert_instance_record_notification failed id=%d after %d attempts: %s',
                    instanceId,
                    attempt,
                    String(err)
                );
                // last_notified_at never persisted — anchor the cooldown in
                // memory so the next re-fire honours it instead of storming.
                recordNotifiedFallback(instanceId);
                return;
            }
            await sleep(RECORD_NOTIFIED_BACKOFF_MS * attempt);
        }
    }
}

// Defer device_offline fire by offlineForSec; cancelled on device_online
// within the window. Returns true when deferral was scheduled.
async function maybeDeferOfflineFire(
    rule: LoadedAlertRule,
    event: NormalizedEvent,
    _match: MatchResult,
    device?: LogicalDeviceHint
): Promise<boolean> {
    if (rule.kind !== 'device_offline') return false;
    if (event.kind !== 'device_offline') return false;
    const seconds = offlineForSecOf(rule);
    if (seconds === null) return false;
    const runAt = new Date(Date.now() + seconds * 1000);
    try {
        const logical =
            device ??
            (await logicalDeviceHint({
                organizationId: rule.organizationId,
                externalId: event.shellyID,
                device: event.device
            }));
        await OutboxWorker.enqueueOfflineFire(
            {
                organizationId: rule.organizationId,
                ruleId: rule.id,
                deviceId: logical.deviceId
            },
            runAt
        );
        return true;
    } catch (err) {
        logger.error(
            'enqueueOfflineFire failed rule=%d device=%s — firing immediately: %s',
            rule.id,
            event.shellyID,
            String(err)
        );
        return false;
    }
}

/** Read offlineForSec from device_offline config; null when unconfigured. */
export function offlineForSecOf(rule: LoadedAlertRule): number | null {
    const v = rule.config.offlineForSec;
    return typeof v === 'number' && v > 0 ? v : null;
}

// Runs when a deferred device_offline fire elapses.
async function normalizeOfflineFirePayload(
    payload: OutboxWorker.OfflineFireTaskPayload
): Promise<OutboxWorker.OfflineFirePayload> {
    if ('deviceId' in payload) return payload;
    return {
        organizationId: payload.organizationId,
        ruleId: payload.ruleId,
        deviceId: await resolveLogicalDeviceId(
            payload.organizationId,
            payload.shellyID
        )
    };
}

export async function handleOfflineFire(
    rawPayload: OutboxWorker.OfflineFireTaskPayload
): Promise<void> {
    const payload = await normalizeOfflineFirePayload(rawPayload);
    const externalId = await findCurrentDeviceExternalId(
        payload.organizationId,
        payload.deviceId
    );
    if (!externalId) return;
    const live = DeviceCollector.getDevice(externalId);
    if (live?.presence === 'online' || live?.online === true) return;
    const rule =
        (await rulesFor(payload.organizationId)).find(
            (r) => r.id === payload.ruleId
        ) ?? null;
    if (!rule) return;
    if (rule.kind !== 'device_offline') return;
    const match = buildDeviceOfflineMatch(
        rule.id,
        rule.name,
        externalId,
        live?.info?.name as string | undefined,
        {offlineForSec: offlineForSecOf(rule)}
    );
    await fireMatch(rule, match, false, {
        deviceId: payload.deviceId,
        externalId
    });
}

// Motion rarely publishes "clear" — schedule auto-resolve when rule.autoResolve
// is on. jobKeyMode: replace lets re-triggers extend the window without stacking.
// Opt-in backend timer; device state is source of truth otherwise.
async function scheduleMotionClearIfApplicable(
    rule: LoadedAlertRule,
    fingerprint: string
): Promise<void> {
    if (rule.kind !== 'motion_detected' || !rule.autoResolve) return;
    const seconds = motionClearTimeoutSec(rule.config);
    if (seconds === null) return;
    const runAt = new Date(Date.now() + seconds * 1000);
    try {
        await OutboxWorker.enqueueMotionClear(
            {
                organizationId: rule.organizationId,
                ruleId: rule.id,
                fingerprint
            },
            runAt
        );
    } catch (err) {
        logger.error(
            'motion clear enqueue failed for rule %d: %s',
            rule.id,
            String(err)
        );
    }
}

/** Fires when a scheduled motion_clear task runs — resolves the alert. */
async function handleMotionClear(params: {
    organizationId: string;
    ruleId: number;
    fingerprint: string;
}): Promise<void> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_auto_resolve',
        {
            p_organization_id: params.organizationId,
            p_rule_id: params.ruleId,
            p_fingerprint_v2: params.fingerprint
        }
    );
    const instance = result?.rows?.[0] as UpsertedInstance | undefined;
    if (!instance) return;
    const rule =
        (await rulesFor(params.organizationId)).find(
            (r) => r.id === params.ruleId
        ) ?? null;
    if (rule) {
        await addInboxItems(rule, instance, 'alert_resolved');
        await routeAlertNotification({rule, instance});
    }
    emitAlertWs('Alert.Resolved', instance);
}

// --- component_state / component_threshold sustained condition (forSec) --

// fingerprint -> the hold we enqueued, so a clear can cancel by key without
// parsing the fingerprint, and a transition is distinguished from a stay.
const stateHoldPending = new BoundedMap<string, OutboxWorker.StateHoldPayload>({
    maxSize: 100_000,
    ttlMs: 25 * 60 * 60 * 1000
});

function forSecOf(rule: LoadedAlertRule): number | null {
    const v = rule.config.forSec;
    return typeof v === 'number' && v > 0 ? v : null;
}

// Defer the fire until the state has held forSec. Schedules only on entering
// the target, so repeated status updates don't reset the timer. Returns true
// when a hold is pending (so the caller suppresses the immediate fire).
async function maybeScheduleStateHold(
    rule: LoadedAlertRule,
    match: MatchResult,
    deviceHint?: LogicalDeviceHint
): Promise<boolean> {
    if (
        rule.kind !== 'component_state' &&
        rule.kind !== 'component_threshold'
    ) {
        return false;
    }
    const forSec = forSecOf(rule);
    if (forSec === null) return false;
    const ctx = match.context ?? {};
    const {component, field, shellyID} = ctx;
    if (
        typeof component !== 'string' ||
        typeof field !== 'string' ||
        typeof shellyID !== 'string'
    ) {
        return false;
    }
    const device =
        deviceHint?.externalId === shellyID
            ? deviceHint
            : await logicalDeviceHint({
                  organizationId: rule.organizationId,
                  externalId: shellyID
              });
    const canonicalMatch = await canonicalizeAlertMatch(
        rule.organizationId,
        rule.id,
        match,
        device
    );
    if (stateHoldPending.has(canonicalMatch.fingerprintV2)) return true;
    await markEvaluationState(
        rule,
        {
            ...canonicalMatch,
            title: `${canonicalMatch.title} pending`,
            message: `${canonicalMatch.message} Waiting ${forSec} seconds before firing.`,
            context: {
                ...(canonicalMatch.context ?? {}),
                pendingReason: 'forSec',
                requiredForSec: forSec,
                pendingSince: new Date().toISOString()
            }
        },
        'pending',
        true
    );
    const payload: OutboxWorker.StateHoldPayload = {
        organizationId: rule.organizationId,
        ruleId: rule.id,
        deviceId: device.deviceId,
        component,
        field,
        fingerprintV2: canonicalMatch.fingerprintV2,
        equals: rule.config.equals as boolean | string | number
    };
    stateHoldPending.set(canonicalMatch.fingerprintV2, payload);
    await OutboxWorker.enqueueStateHold(
        payload,
        new Date(Date.now() + forSec * 1000)
    );
    return true;
}

// Cancel a pending hold when the state leaves target before forSec elapses.
async function cancelStateHoldForFingerprint(
    rule: LoadedAlertRule,
    fp: string,
    device: LogicalDeviceHint
): Promise<void> {
    const canonical = await canonicalAlertFingerprint(
        rule.organizationId,
        rule.id,
        fp,
        device
    );
    const payload = stateHoldPending.get(canonical);
    if (!payload) return;
    stateHoldPending.delete(canonical);
    await OutboxWorker.cancelStateHold(
        payload.ruleId,
        payload.deviceId,
        payload.component,
        payload.field
    );
}

// If the device isn't back when the hold fires (e.g. right after a restart),
// reschedule a bounded number of times so the held alert isn't silently lost.
const STATE_HOLD_DEVICE_RETRY_MS = 30_000;
const STATE_HOLD_MAX_DEVICE_RETRIES = 5;

export function stateHoldDeviceRetry(
    attempt: number | undefined,
    maxRetries: number
): {retry: boolean; nextAttempt: number} {
    const nextAttempt = (attempt ?? 0) + 1;
    return {retry: nextAttempt <= maxRetries, nextAttempt};
}

async function normalizeStateHoldPayload(
    payload: OutboxWorker.StateHoldTaskPayload
): Promise<OutboxWorker.StateHoldPayload> {
    if ('deviceId' in payload) return payload;
    return {
        organizationId: payload.organizationId,
        ruleId: payload.ruleId,
        deviceId: await resolveLogicalDeviceId(
            payload.organizationId,
            payload.shellyID
        ),
        component: payload.component,
        field: payload.field,
        fingerprintV2: payload.fingerprintV2,
        equals: payload.equals,
        attempt: payload.attempt
    };
}

// Re-checks the live state still holds before firing, so a missed cancel or a
// flap during the window can never produce a false fire. Exported as the
// OutboxWorker hold handler (registered at start).
export async function handleStateHold(
    rawPayload: OutboxWorker.StateHoldTaskPayload
): Promise<void> {
    const payload = await normalizeStateHoldPayload(rawPayload);
    const externalId = await findCurrentDeviceExternalId(
        payload.organizationId,
        payload.deviceId
    );
    if (!externalId) return;
    const rawFingerprint =
        payload.fingerprintV2 ??
        fieldFingerprintV2({
            ruleId: payload.ruleId,
            subjectType: 'device',
            subjectId: String(payload.deviceId),
            component: payload.component,
            field: payload.field
        });
    const fp = await canonicalAlertFingerprint(
        payload.organizationId,
        payload.ruleId,
        rawFingerprint,
        {deviceId: payload.deviceId, externalId}
    );
    stateHoldPending.delete(fp);
    const rule =
        (await rulesFor(payload.organizationId)).find(
            (r) => r.id === payload.ruleId
        ) ?? null;
    if (!rule) return;
    const device = DeviceCollector.getDevice(externalId);
    if (!device) {
        const {retry, nextAttempt} = stateHoldDeviceRetry(
            payload.attempt,
            STATE_HOLD_MAX_DEVICE_RETRIES
        );
        if (retry) {
            await OutboxWorker.enqueueStateHold(
                {...payload, attempt: nextAttempt},
                new Date(Date.now() + STATE_HOLD_DEVICE_RETRY_MS)
            );
        } else {
            await markEvaluationState(
                rule,
                {
                    fingerprintV2: fp,
                    title: `${externalId} has no data`,
                    message: `Rule "${rule.name}" could not evaluate because required data is missing.`,
                    subject: {type: 'device', id: String(payload.deviceId)},
                    context: {
                        shellyID: externalId,
                        reason: 'device_missing_for_hold',
                        component: payload.component,
                        field: payload.field
                    }
                },
                'no_data',
                true
            );
        }
        return;
    }
    const evaluator = getEvaluator(rule.kind);
    if (!evaluator) return;
    const event: NormalizedEvent = {
        kind: 'device_status_changed',
        organizationId: payload.organizationId,
        shellyID: externalId,
        status: device.status as Record<string, unknown>,
        device
    };
    const matches = await Promise.all(
        (await collectMatches(rule, evaluator, event)).map((match) =>
            canonicalizeAlertMatch(rule.organizationId, rule.id, match, {
                deviceId: payload.deviceId,
                externalId
            })
        )
    );
    const match = matches.find((candidate) => candidate.fingerprintV2 === fp);
    if (!match) {
        await resolveFingerprint(rule, fp, {
            deviceId: payload.deviceId,
            externalId
        });
        return;
    }
    await fireMatch(
        rule,
        {
            ...match,
            context: {
                ...(match.context ?? {}),
                heldForSec: forSecOf(rule) ?? undefined
            }
        },
        true
    );
}

async function onClear(
    rule: LoadedAlertRule,
    evaluator: Evaluator,
    event: NormalizedEvent
): Promise<void> {
    await cancelPendingOfflineFireIfApplicable(rule, event);
    const fingerprints = clearFingerprints(evaluator, event, rule);
    const device =
        'shellyID' in event
            ? await logicalDeviceHint({
                  organizationId: event.organizationId,
                  externalId: event.shellyID,
                  device: 'device' in event ? event.device : undefined
              })
            : undefined;
    for (const fingerprint of fingerprints) {
        if (device) {
            await cancelStateHoldForFingerprint(rule, fingerprint, device);
        }
    }
    if (!rule.autoResolve) return;
    for (const fingerprint of fingerprints) {
        await resolveFingerprint(rule, fingerprint, device);
    }
}

// All recovered subjects; falls back to the single matchClear.
function clearFingerprints(
    evaluator: Evaluator,
    event: NormalizedEvent,
    rule: LoadedAlertRule
): readonly string[] {
    const all = evaluator.matchClearAll?.(event, rule);
    if (all) return all;
    const single = evaluator.matchClear?.(event, rule);
    return single ? [single.fingerprintV2] : [];
}

export async function resolveFingerprint(
    rule: LoadedAlertRule,
    fingerprintV2: string,
    device?: LogicalDeviceHint
): Promise<void> {
    const persistedFingerprint = await canonicalAlertFingerprint(
        rule.organizationId,
        rule.id,
        fingerprintV2,
        device
    );
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_auto_resolve',
        {
            p_organization_id: rule.organizationId,
            p_rule_id: rule.id,
            p_fingerprint_v2: persistedFingerprint
        }
    );
    const instance = result?.rows?.[0] as UpsertedInstance | undefined;
    if (!instance) return;
    if (isSilentEvaluationLifecycle(instance)) {
        emitAlertWs('Alert.Resolved', instance);
        return;
    }
    await addInboxItems(rule, instance, 'alert_resolved');
    await routeAlertNotification({rule, instance});
    emitAlertWs('Alert.Resolved', instance);
}

function isSilentEvaluationLifecycle(instance: UpsertedInstance): boolean {
    const state = instance.context?.lifecycleState;
    return (
        state === 'pending' ||
        state === 'recovering' ||
        state === 'no_data' ||
        state === 'evaluation_error'
    );
}

// device_online cancels pending offline-fire for the (rule, device) pair.
// Runs independent of autoResolve so brief flaps never fire.
async function cancelPendingOfflineFireIfApplicable(
    rule: LoadedAlertRule,
    event: NormalizedEvent
): Promise<void> {
    if (rule.kind !== 'device_offline') return;
    if (event.kind !== 'device_online') return;
    if (offlineForSecOf(rule) === null) return;
    const device = await logicalDeviceHint({
        organizationId: event.organizationId,
        externalId: event.shellyID,
        device: event.device
    });
    await OutboxWorker.cancelOfflineFire(rule.id, device.deviceId);
}

// --- Group flush --------------------------------------------------------

// Called by OutboxWorker when a delivery_group_flush task fires. Loads
// members, builds one multi-alert payload per endpoint, enqueues one
// delivery_send, then records the notification and reschedules if the
// group is still active.
interface GroupFlushRow {
    endpoint_id: number;
    alert_ids: number[];
}

interface GroupAlertRow {
    id: number;
    organization_id: string;
    rule_id: number;
    rule_kind: string;
    state: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    source_subject_type: string;
    source_subject_id: string;
    context: Record<string, unknown> | null;
    last_triggered_at: string;
    active_since: string;
}

async function loadGroupAlerts(
    alertIds: readonly number[]
): Promise<GroupAlertRow[]> {
    if (alertIds.length === 0) return [];
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_get_batch',
        {p_alert_ids: alertIds}
    );
    return (result?.rows ?? []) as GroupAlertRow[];
}

async function loadDeliveryJobsForGroup(
    alertIds: readonly number[],
    endpointId: number
): Promise<DeliveryJobReference[]> {
    if (alertIds.length === 0) return [];
    const result = await PostgresProvider.callMethod(
        'notifications.fn_delivery_job_for_group',
        {p_alert_ids: alertIds, p_endpoint_id: endpointId}
    );
    return (result?.rows ?? []) as DeliveryJobReference[];
}

function buildAggregate(payloads: DeliveryPayload[]) {
    let critical = 0;
    let warning = 0;
    let info = 0;
    for (const p of payloads) {
        if (p.severity === 'critical') critical++;
        else if (p.severity === 'warning') warning++;
        else info++;
    }
    const firedAts = payloads.map((p) => p.firedAt).sort();
    return {
        total: payloads.length,
        critical,
        warning,
        info,
        firstAt: firedAts[0] ?? '',
        lastAt: firedAts[firedAts.length - 1] ?? ''
    };
}

interface FlushBatch {
    rows: GroupFlushRow[];
    payloadFor: (alertId: number) => DeliveryPayload | null;
}

// Resolve each rule's message template once (cached) for a flush batch.
async function resolveTemplatesForRules(
    organizationId: string,
    rules: LoadedAlertRule[]
): Promise<Map<number, ResolvedMessageTemplate | null>> {
    const out = new Map<number, ResolvedMessageTemplate | null>();
    for (const rule of rules) {
        if (rule.templateId == null) continue;
        out.set(
            rule.id,
            await resolveMessageTemplate(organizationId, rule.templateId)
        );
    }
    return out;
}

async function loadFlushBatch(groupId: number): Promise<FlushBatch | null> {
    const flushResult = await PostgresProvider.callMethod(
        'notifications.fn_delivery_group_flush_load',
        {p_group_id: groupId}
    );
    const rows = (flushResult?.rows ?? []) as GroupFlushRow[];
    if (rows.length === 0) return null;

    const allAlertIds = Array.from(new Set(rows.flatMap((r) => r.alert_ids)));
    const alertRows = await loadGroupAlerts(allAlertIds);
    if (alertRows.length === 0) return null;
    const organizationId = alertRows[0].organization_id;
    const rules = await rulesFor(organizationId);
    const ruleById = new Map(rules.map((r) => [r.id, r]));
    const alertById = new Map(alertRows.map((a) => [a.id, a]));

    // Pre-resolve each distinct rule's message template once (cached) so the
    // sync payloadFor can attach it; delivery renders it per channel.
    const templateByRuleId = await resolveTemplatesForRules(
        organizationId,
        rules
    );

    // Each alert renders against its own rule's templates.
    const payloadFor = (alertId: number): DeliveryPayload | null => {
        const a = alertById.get(alertId);
        if (!a) return null;
        const rule = ruleById.get(a.rule_id);
        if (!rule) return null;
        const payload = buildAlertPayload(rule, a);
        payload.template = templateByRuleId.get(rule.id) ?? null;
        return payload;
    };
    return {rows, payloadFor};
}

function buildEnvelope(payloads: DeliveryPayload[]): DeliveryPayload {
    const [leader, ...siblings] = payloads;
    return {
        ...leader,
        siblings: siblings.length > 0 ? siblings : undefined,
        aggregate: siblings.length > 0 ? buildAggregate(payloads) : undefined
    };
}

async function enqueueRowJobs(
    row: GroupFlushRow,
    payloadFor: (id: number) => DeliveryPayload | null
): Promise<void> {
    const payloads = row.alert_ids
        .map(payloadFor)
        .filter((p): p is DeliveryPayload => p !== null);
    if (payloads.length === 0) return;
    const jobs = await loadDeliveryJobsForGroup(row.alert_ids, row.endpoint_id);
    if (jobs.length === 0) return;
    const envelope = buildEnvelope(payloads);
    const organizationId = payloads[0].organizationId;
    for (const job of jobs) {
        await enqueueSendOrAbort(job, envelope, organizationId);
    }
}

async function enqueueSendOrAbort(
    job: DeliveryJobReference,
    envelope: DeliveryPayload,
    organizationId: string
): Promise<void> {
    try {
        await OutboxWorker.enqueueSend({
            deliveryJobId: job.id,
            message: envelope
        });
    } catch (err) {
        await abortJobAfterFlushEnqueueFailure(job, organizationId, err);
    }
}

// Flush enqueue uses graphile-worker.addJob; if that throws, the
// delivery_job row stays in 'queued' with no graphile task to claim it
// (and the surrounding markFlushAndReschedule will move the group's
// state machine past this bucket). Mark the row failed so it surfaces
// in the UI instead of becoming an orphan.
async function abortJobAfterFlushEnqueueFailure(
    job: DeliveryJobReference,
    organizationId: string,
    cause: unknown
): Promise<void> {
    const reason = `group flush enqueue failed: ${describeError(cause)}`;
    logger.error(
        'group flush enqueue delivery_job %d failed — aborting: %s',
        job.id,
        reason
    );
    Observability.incrementCounter('group_flush_enqueue_failures');
    await abortDeliveryJobSafely({
        organizationId,
        job,
        reason,
        abortFailureMetricName: 'group_flush_abort_failures'
    });
}

async function markFlushAndReschedule(groupId: number): Promise<void> {
    const markResult = await PostgresProvider.callMethod(
        'notifications.fn_delivery_group_mark_notified',
        {p_group_id: groupId}
    );
    const mark = markResult?.rows?.[0] as
        | {has_active_members: boolean; member_count: number}
        | undefined;
    if (!mark?.has_active_members) return;
    const runAt = new Date(Date.now() + tuning.alert.groupIntervalSec * 1000);
    await OutboxWorker.enqueueGroupFlush(groupId, runAt, true);
}

async function handleGroupFlush(groupId: number): Promise<void> {
    // OWASP API7:2023 — external interactions must have a deadline so a
    // hung adapter cannot pin the worker. Standard practice: timeout the
    // whole flush, let the next tick retry.
    await withTimeout(
        () => doHandleGroupFlush(groupId),
        tuning.alert.groupFlushTimeoutMs,
        `group-flush:${groupId}`
    );
}

async function doHandleGroupFlush(groupId: number): Promise<void> {
    const batch = await loadFlushBatch(groupId);
    if (!batch) return;
    for (const row of batch.rows) {
        await enqueueRowJobs(row, batch.payloadFor);
    }
    await markFlushAndReschedule(groupId);
}

async function handleEscalationStage(
    payload: OutboxWorker.DeliveryEscalationStagePayload
): Promise<void> {
    const instance = await loadEscalationAlert(payload);
    if (!instance) return;
    // Stop-on-ack/resolve/clear: only an active alert keeps escalating. An ack
    // means someone owns it, so further rings stop.
    if (instance.state !== 'active') {
        Observability.incrementCounter('alert_escalation_skipped_by_state');
        return;
    }
    // Stop-on-silence: per-alert silence cancels escalation too.
    if (isEscalationSilenced(instance)) {
        Observability.incrementCounter(
            'alert_escalation_suppressed_by_silence'
        );
        return;
    }
    const rule = (await rulesFor(payload.organizationId)).find(
        (candidate) => candidate.id === payload.ruleId
    );
    if (!rule) return;
    await routeEscalationStageNotification({
        rule,
        instance,
        stage: payload.stage
    });
}

function isEscalationSilenced(instance: RoutableEscalationAlert): boolean {
    const until = instance.silenced_until;
    if (!until) return false;
    const ts = new Date(until).getTime();
    return Number.isFinite(ts) && ts > Date.now();
}

async function loadEscalationAlert(
    payload: OutboxWorker.DeliveryEscalationStagePayload
): Promise<RoutableEscalationAlert | null> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_get',
        {
            p_organization_id: payload.organizationId,
            p_id: payload.alertId
        }
    );
    const row = result?.rows?.[0] as RoutableEscalationAlert | undefined;
    return row ?? null;
}

type RoutableEscalationAlert = {
    id: number;
    organization_id: string;
    rule_id: number;
    rule_kind: string;
    state: string;
    severity: 'info' | 'warning' | 'critical';
    source_subject_type: string;
    source_subject_id: string;
    title: string;
    message: string;
    active_since: string;
    last_triggered_at: string;
    silenced_until?: string | null;
};

async function dispatch(event: NormalizedEvent): Promise<void> {
    // Surface a rule-load blip instead of rejecting into a dropped subscriber
    // promise. No rules → nothing to evaluate, so skip the event.
    const rules = await rulesFor(event.organizationId).catch((err) => {
        Observability.incrementCounter('alert_rules_load_failed');
        logger.warn(
            'rulesFor failed for event kind=%s org=%s: %s — event not dispatched',
            event.kind,
            event.organizationId,
            String(err)
        );
        return undefined;
    });
    if (!rules) return;
    // Subject resolver hits the DB. A transient failure must NOT silence
    // every rule — fall back to an empty subject so wildcard-scope rules
    // still fire. Scoped rules (groupIds/locationIds/tagIds) will not
    // match an empty subject, which is fail-closed for them.
    const subject = await subjectForEvent(event).catch((err) => {
        Observability.incrementCounter('alert_subject_resolve_failed');
        logger.warn(
            'subjectForEvent failed for event kind=%s org=%s: %s',
            event.kind,
            event.organizationId,
            String(err)
        );
        return {} as Awaited<ReturnType<typeof subjectForEvent>>;
    });
    // One slow rule must not pin the event-loop slot.
    const RULE_DISPATCH_TIMEOUT_MS = 30_000;
    await runBoundedParallel({
        tasks: rules,
        concurrency: tuning.alert.dispatchConcurrency,
        perTaskTimeoutMs: RULE_DISPATCH_TIMEOUT_MS,
        label: 'alert-dispatch',
        run: async (rule) => {
            const evaluator = getEvaluator(rule.kind);
            if (!evaluator) return;
            if (!matchesScope(rule.scope, subject)) return;

            const handlesTrigger = evaluator.triggerKinds.includes(event.kind);
            const handlesClear =
                evaluator.clearKinds?.includes(event.kind) ?? false;

            try {
                if (handlesTrigger) await onTrigger(rule, evaluator, event);
                if (handlesClear) await onClear(rule, evaluator, event);
            } catch (err) {
                logger.error(
                    'rule %d (%s) evaluation failed: %s',
                    rule.id,
                    rule.kind,
                    String(err)
                );
            }
        }
    });
}

// Public entry point. Per-rule errors are logged and swallowed so one
// failing rule cannot block another.
export async function ingestEvent(event: NormalizedEvent): Promise<void> {
    if (!started) return;
    await dispatch(event);
}

// --- Typed producer shims -----------------------------------------------
//
// One-liner helpers so components do not have to open-code the event
// envelope. Keeps the shape centralized here — evaluators and bus
// subscribers stay in lockstep.

export function reportFirmwareOperationFailed(
    organizationId: string,
    shellyID: string,
    errorMessage: string
): Promise<void> {
    return ingestEvent({
        kind: 'firmware_operation_failed',
        organizationId,
        shellyID,
        errorMessage
    });
}

export function reportBackupOperationFailed(
    organizationId: string,
    shellyID: string,
    errorMessage: string
): Promise<void> {
    return ingestEvent({
        kind: 'backup_operation_failed',
        organizationId,
        shellyID,
        errorMessage
    });
}

export function reportAutomationRunFailed(
    organizationId: string,
    automationId: number,
    automationName: string,
    errorMessage: string
): Promise<void> {
    return ingestEvent({
        kind: 'automation_run_failed',
        organizationId,
        automationId,
        automationName,
        errorMessage
    });
}

export interface GrafanaAlertEvent {
    status: 'firing' | 'resolved';
    fingerprint: string;
    alertName: string;
    summary: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
}

export function reportGrafanaAlert(
    organizationId: string,
    alert: GrafanaAlertEvent
): Promise<void> {
    return ingestEvent({kind: 'grafana_alert', organizationId, ...alert});
}

// --- Bus subscriptions + lifecycle --------------------------------------

let started = false;
const listenerIds: number[] = [];
let deviceEventUnsubscribe: (() => void) | undefined;

function subscribe(eventName: string, handler: (e: unknown) => void): void {
    const id = EventDistributor.addEventListener(
        CommandSender.INTERNAL,
        eventName,
        {},
        // addEventListener expects (event, shellyID, eventData) — we
        // only need the event body.
        (event) => handler(event)
    );
    listenerIds.push(id);
}

function normalizeShelly(
    eventName: 'device_offline' | 'device_online',
    raw: unknown
): NormalizedEvent | null {
    const params = (raw as {params?: {shellyID?: string}})?.params;
    const shellyID = params?.shellyID;
    if (!shellyID) return null;
    const organizationId = EventDistributor.getDeviceOrg(shellyID);
    if (!organizationId) {
        // Race window between WaitingRoom approval and setDeviceOrg.
        // Track silently — without this counter the drop is invisible.
        Observability.incrementCounter('alert_event_dropped_unknown_org');
        return null;
    }
    return {kind: eventName, organizationId, shellyID};
}

function normalizeShellyStatus(raw: unknown): NormalizedEvent | null {
    const params = (
        raw as {
            params?: {shellyID?: string; status?: Record<string, unknown>};
        }
    )?.params;
    const shellyID = params?.shellyID;
    const status = params?.status;
    if (!shellyID || !status) return null;
    const organizationId = EventDistributor.getDeviceOrg(shellyID);
    if (!organizationId) {
        Observability.incrementCounter('alert_event_dropped_unknown_org');
        return null;
    }
    const device = DeviceCollector.getDevice(shellyID) ?? undefined;
    return {
        kind: 'device_status_changed',
        organizationId,
        shellyID,
        device,
        status
    };
}

// Drops events for unresolved orgs — same fail-closed pattern as status.
function normalizeDeviceEvent(
    envelope: ShellyEvents.DeviceEventEnvelope
): NormalizedEvent | null {
    const organizationId = EventDistributor.getDeviceOrg(envelope.shellyID);
    if (!organizationId) {
        // Untrusted device (no org) — drop like status events.
        Observability.incrementCounter('alert_event_dropped_unknown_org');
        return null;
    }
    const device = DeviceCollector.getDevice(envelope.shellyID) ?? undefined;
    return {
        kind: 'device_event_received',
        organizationId,
        shellyID: envelope.shellyID,
        device,
        componentType: envelope.componentType,
        componentKey: envelope.componentKey,
        event: envelope.event,
        ts: envelope.ts,
        attrs: envelope.attrs
    };
}

export function start(): void {
    if (started) return;
    started = true;

    OutboxWorker.registerMotionClearHandler(handleMotionClear);
    OutboxWorker.registerOfflineFireHandler(handleOfflineFire);
    OutboxWorker.registerStateHoldHandler(handleStateHold);
    OutboxWorker.registerGroupFlushHandler(handleGroupFlush);
    OutboxWorker.registerEscalationStageHandler(handleEscalationStage);
    OutboxWorker.registerDigestFlushHandler(handleDigestFlush);

    subscribe('Shelly.Disconnect', (raw) => {
        const e = normalizeShelly('device_offline', raw);
        if (e) void ingestEvent(e).catch(logIngestError);
    });
    subscribe('Shelly.Connect', (raw) => {
        const e = normalizeShelly('device_online', raw);
        if (e) void ingestEvent(e).catch(logIngestError);
    });
    subscribe('Shelly.Status', (raw) => {
        const e = normalizeShellyStatus(raw);
        if (e) void ingestEvent(e).catch(logIngestError);
    });
    deviceEventUnsubscribe = ShellyEvents.onDeviceEvent((envelope) => {
        const e = normalizeDeviceEvent(envelope);
        if (e) void ingestEvent(e).catch(logIngestError);
    });

    logger.info(
        'AlertEngine started — %d rule kind(s) wired: %s',
        registeredKinds().length,
        registeredKinds().join(', ')
    );
}

export function stop(): void {
    if (!started) return;
    for (const id of listenerIds) {
        EventDistributor.removeEventListener(id, '');
    }
    listenerIds.length = 0;
    deviceEventUnsubscribe?.();
    deviceEventUnsubscribe = undefined;
    rulesByOrg.clear();
    orgEvalQueued.clear();
    orgEvalRerunPending.clear();
    started = false;
    logger.info('AlertEngine stopped');
}
