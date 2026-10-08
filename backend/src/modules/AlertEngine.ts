// AlertEngine — rule eval + instance upsert + inbox/delivery fan-out + WS emit.
// Rule cache is per-org, invalidated by Rule mutation events.

import * as log4js from 'log4js';
import {tuning} from '../config';
import {groupPolicy} from '../config/groupPolicy';
import type AbstractDevice from '../model/AbstractDevice';
import CommandSender from '../model/CommandSender';
import type {event_data_t} from '../types';
import {
    ALERT_RULE_KIND_DESCRIPTOR_BY_KEY,
    type AlertRuleKind,
    type AlertSeverity,
    publicAlertRuleKind,
    type ScopeSelector,
    storedAlertRuleKind
} from '../types/api/alert';
import * as AlertEvents from './AlertEvents';
import {ruleIsActiveAt} from './alert/activeWindow';
import {
    type FixtureCandidate,
    resolveLeakAttribution,
    withLeakAttribution
} from './alert/coldChainAttribution';
import {
    bluetoothAlertDevice,
    deviceSnapshotFromStoredRow,
    promotedComponentsByGateway,
    type StoredDeviceSnapshotRow,
    storedDeviceSnapshots
} from './alert/deviceSnapshots';
import {
    type OrganizationRuleEvaluationRequest,
    registerOrganizationRuleEvaluator
} from './alert/evaluationPort';
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
import {FireBatchWriter} from './alert/fireBatchWriter';
import {
    canonicalAlertFingerprint,
    canonicalizeAlertMatch,
    findCurrentDeviceExternalId,
    type LogicalDeviceHint,
    resolveLogicalDeviceId
} from './alert/logicalDeviceFingerprint';
import {
    type AlertIdentity,
    getNotifiedFallbackMs,
    recordNotifiedFallback
} from './alert/notifiedFallback';
import {
    alertStateKey,
    alertStateRecheckDelayMs,
    applyPeerAlertSignal,
    clearOpenAlertSet,
    invalidateOpenAlertSet,
    lookupOpenAlert,
    noteAlertState,
    offlineFireMayBePending,
    peekOpenAlert,
    publishAlertStateChange
} from './alert/openAlertSet';
import {
    AlertReadAbortedError,
    invalidateOpenInstanceReadBatches,
    OpenInstanceReadBatch,
    type OpenInstanceRow,
    readOpenInstance
} from './alert/openInstanceReadBatch';
import {
    bluetoothDevicesForPresence,
    deviceReachability
} from './alert/reachability';
import {type RuleRowShape, rowToLoadedRule} from './alert/ruleRow';
import {hydratePublicRuleScopes} from './alert/ruleScopePersistence';
import {matchesScope} from './alert/scope';
import {alertAlreadyFiring} from './alert/states';
import {storedDevicePresence} from './alert/storedPresence';
import {resolveSubjectForEvent} from './alert/subjectForEvent';
import {renderTemplate} from './alert/templateRenderer';
import {
    BLUETOOTH_KIND,
    type ClearedReading,
    type ClearMatch,
    type Evaluator,
    type LoadedAlertRule,
    type MatchResult,
    type NormalizedEvent
} from './alert/types';
import {BoundedMap} from './boundedMap';
import * as DeviceCollector from './DeviceCollector';
import {runAsBackgroundDbWork, runAsDbWorkload} from './dbWorkPriority';
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
    resolveInboxRecipientUsersByMode,
    resolveRuleRecipientUsers
} from './notification/RecipientResolver';
import * as Observability from './Observability';
import {
    alertFireMetrics,
    watchAlertFireQueue
} from './observability/alertFireMetrics';
import {getOrganizationProfile} from './organizationModel';
import * as PostgresProvider from './PostgresProvider';
import {type PostgresTxContext, withPostgresTransaction} from './postgresTx';
import {type OrgSignal, onAnyOrg} from './redis/OrgSignals';
import * as ShellyEvents from './ShellyEvents';
import {SingleFlight} from './singleFlight';
import {fireAndForget} from './util/fireAndForget';
import {runBoundedParallel} from './util/runBoundedParallel';
import {withTimeout} from './util/withTimeout';
import {
    bluetoothGatewayRouteCacheKey,
    getBluetoothStatusRoutesForGateways
} from './virtualDevice/bluetoothStatusRouteCache';
import {assignVirtualComponentIds} from './virtualDevice/entityProjection';
import type {SourceSnapshot} from './virtualDevice/readModel';
import {
    listVirtualEntityBindings,
    resolveVirtualEntityBindings,
    type VirtualEntityResolution
} from './virtualDevice/virtualEntityResolver';
import {projectionBindingsForSource} from './virtualDevice/virtualProjectionRouteCache';
import {
    attachVirtualRoleContext,
    enrichVirtualAlertMatch
} from './virtualDeviceAlerts';

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

// One entry per (tenant, rule, fingerprint); a missing entry means unknown.
// `request` is the last upsert request that left the alert open: the same
// request again cannot change the row, so it needs no database call.
interface AlertInstanceTransitionState {
    organizationId: string;
    open: boolean;
    request?: string;
    latched?: boolean;
    recheckAtMs: number;
}

// Sized for every rule and subject of a large fleet (about 150 bytes each);
// the re-check bounds a transition missed from another process.
const ALERT_STATE_MAX = 200_000;
let alertStateSignalsSubscribed = false;

export {alertStateRecheckDelayMs};

// The longest re-check delay; readAlertState drops an entry earlier.
const alertInstanceTransitionState = new BoundedMap<
    string,
    AlertInstanceTransitionState
>({
    maxSize: ALERT_STATE_MAX,
    ttlMs: alertStateRecheckDelayMs(1)
});

function readAlertState(key: string): AlertInstanceTransitionState | undefined {
    const entry = alertInstanceTransitionState.get(key);
    if (entry && entry.recheckAtMs <= Date.now()) {
        alertInstanceTransitionState.delete(key);
        return undefined;
    }
    return entry;
}
const alertTransitionLoads = new SingleFlight<string, boolean>(
    'alert_transition_state'
);
const alertResolutionFlights = new SingleFlight<string, void>(
    'alert_resolution'
);

const alertTransitionKey = alertStateKey;

function rememberOpenAlertInstance(
    organizationId: string,
    ruleId: number,
    fingerprint: string,
    known: {request?: string; latched?: boolean} = {}
): void {
    alertInstanceTransitionState.set(
        alertTransitionKey(organizationId, ruleId, fingerprint),
        {
            organizationId,
            open: true,
            ...known,
            recheckAtMs: Date.now() + alertStateRecheckDelayMs()
        }
    );
}

function rememberClosedAlertInstance(
    organizationId: string,
    ruleId: number,
    fingerprint: string
): void {
    alertInstanceTransitionState.set(
        alertTransitionKey(organizationId, ruleId, fingerprint),
        {
            organizationId,
            open: false,
            recheckAtMs: Date.now() + alertStateRecheckDelayMs()
        }
    );
}

function knownOpen(key: string): boolean {
    return readAlertState(key)?.open === true;
}

function invalidateAlertTransitionState(organizationId: string): void {
    for (const [key, state] of alertInstanceTransitionState) {
        if (state.organizationId === organizationId) {
            alertInstanceTransitionState.delete(key);
        }
    }
}

// Tell other Fleet processes; each drops the same state on receipt.
function publishAlertStateChanged(
    organizationId: string,
    alertKey?: string
): void {
    publishAlertStateChange(organizationId, alertKey ? {alertKey} : {});
}

export function applyAlertStateSignal(signal: OrgSignal): void {
    if (signal.kind !== 'alert-state-changed') return;
    if (applyPeerAlertSignal(signal)) {
        invalidateAlertTransitionState(signal.orgId);
    } else if (typeof signal.alertKey === 'string') {
        // The key comes from a peer and the map holds every tenant's keys, so
        // drop the entry only when it is the signalling tenant's own.
        const entry = alertInstanceTransitionState.get(signal.alertKey);
        if (entry?.organizationId === signal.orgId) {
            alertInstanceTransitionState.delete(signal.alertKey);
        }
    }
}

/** The row an operator action (ack, resolve, silence) returned. */
export interface OperatorChangedAlert {
    id: number;
    organization_id: string;
    rule_id: number;
    fingerprint: string;
    state: string;
    resolved_at: Date | string | null;
}

/** Call after an operator changes one alert; the rest of the tenant holds. */
export function noteOperatorAlertChange(row: OperatorChangedAlert): void {
    const scope = {
        organizationId: row.organization_id,
        ruleId: row.rule_id,
        fingerprint: row.fingerprint
    };
    const key = alertTransitionKey(
        scope.organizationId,
        scope.ruleId,
        scope.fingerprint
    );
    // The remembered request may skip a write the changed row now needs.
    alertInstanceTransitionState.delete(key);
    noteAlertState(
        scope,
        row.resolved_at == null ? {id: row.id, state: row.state} : null
    );
    publishAlertStateChanged(scope.organizationId, key);
}

/** Call when a rule changes — Rule.Create / Rule.Update / Rule.Delete. */
export function invalidateRuleCache(organizationId: string): void {
    rulesByOrg.delete(organizationId);
    invalidateAlertTransitionState(organizationId);
    invalidateOpenAlertSet(organizationId);
    invalidateOpenInstanceReadBatches(organizationId);
}

// The org open set follows the row this process just wrote.
function noteWrittenInstance(scope: {
    organizationId: string;
    ruleId: number;
    fingerprint: string;
    instance?: UpsertedInstance;
}): void {
    const {instance} = scope;
    noteAlertState(
        scope,
        instance && instance.resolved_at == null
            ? {id: instance.id, state: instance.state}
            : null
    );
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
    resolved_at?: string | null;
    silenced_until?: string | null;
    was_created: boolean;
    changed: boolean;
}

function rememberReturnedInstanceOpen(
    instance: UpsertedInstance,
    request?: string
): void {
    noteWrittenInstance({
        organizationId: instance.organization_id,
        ruleId: instance.rule_id,
        fingerprint: instance.fingerprint,
        instance
    });
    if (instance.resolved_at == null) {
        rememberOpenAlertInstance(
            instance.organization_id,
            instance.rule_id,
            instance.fingerprint,
            {request, latched: instance.state.startsWith('cleared')}
        );
    } else {
        rememberClosedAlertInstance(
            instance.organization_id,
            instance.rule_id,
            instance.fingerprint
        );
    }
    if (rowChanged(instance)) {
        publishAlertStateChanged(
            instance.organization_id,
            alertTransitionKey(
                instance.organization_id,
                instance.rule_id,
                instance.fingerprint
            )
        );
    }
}

// Everything the upsert decides on besides the stored row (message and
// context are stored once at open and do not count as a change).
function upsertRequestKey(rule: LoadedAlertRule, match: MatchResult): string {
    const floors = groupPolicy().severityFloorByType;
    return JSON.stringify([
        match.severity ?? rule.severity,
        match.title,
        match.subject.type,
        match.subject.id,
        floors.standard,
        floors.operational,
        floors.critical,
        floors.custom,
        rule.dedupeWindowSec
    ]);
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
    isCanonical: boolean,
    device: LogicalDeviceHint | undefined,
    tx: PostgresTxContext
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
        },
        tx.txId
    );
    const instance = result?.rows?.[0] as UpsertedInstance | undefined;
    if (instance) {
        // A rolled-back write must not be remembered: the next identical fire
        // would be skipped and the alert never stored.
        const request = upsertRequestKey(rule, persistedMatch);
        tx.onCommit(() => rememberReturnedInstanceOpen(instance, request));
    }
    return instance;
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
    rememberReturnedInstanceOpen(instance);
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

interface InboxRecipients {
    /** The rule's users, read before any transaction opens. */
    readonly userIds: readonly string[];
    readonly txId?: number;
}

// Users come only from destination groups; a rule without one skips the read.
async function ruleRecipientUsers(rule: LoadedAlertRule): Promise<string[]> {
    if (rule.destinationGroupIds.length === 0) return [];
    return resolveRuleRecipientUsers({
        organizationId: rule.organizationId,
        ruleId: rule.id
    });
}

// Returns the rows it inserted rather than emitting them, so a caller inside a
// transaction can emit only after the commit.
async function addInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved',
    recipients: InboxRecipients
): Promise<InsertedInboxItem[]> {
    const {txId} = recipients;
    const users = await resolveInboxRecipientUsersByMode({
        organizationId: rule.organizationId,
        userIds: recipients.userIds,
        severity: instance.severity,
        txId
    });
    // rule.deliveryMode='digest' forces every recipient into the digest
    // queue, overriding per-user preference.
    if (rule.deliveryMode === 'digest') {
        const allUserIds = [...users.immediateUserIds, ...users.digestUserIds];
        await queueDigestInboxItems(rule, instance, kind, allUserIds, txId);
        return [];
    }
    const inserted = await addImmediateInboxItems(
        rule,
        instance,
        kind,
        users.immediateUserIds,
        txId
    );
    await queueDigestInboxItems(
        rule,
        instance,
        kind,
        users.digestUserIds,
        txId
    );
    return inserted;
}

async function addResolvedInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance
): Promise<void> {
    const userIds = await ruleRecipientUsers(rule);
    emitInsertedInboxItems(
        await addInboxItems(rule, instance, 'alert_resolved', {userIds})
    );
}

async function addImmediateInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved',
    userIds: string[],
    txId?: number
): Promise<InsertedInboxItem[]> {
    if (userIds.length === 0) return [];
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
        },
        txId
    );
    return (result?.rows ?? []) as InsertedInboxItem[];
}

async function queueDigestInboxItems(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved',
    userIds: string[],
    txId?: number
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
        },
        txId
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

async function subjectForEvent(
    event: NormalizedEvent,
    scopes: readonly ScopeSelector[]
) {
    return resolveSubjectForEvent(event, PostgresProvider.callMethod, scopes);
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

interface EventEvaluationContext {
    readonly event: NormalizedEvent;
    readonly resolveDevice: () => Promise<LogicalDeviceHint | undefined>;
}

interface RuleEvaluation {
    rule: LoadedAlertRule;
    evaluator: Evaluator;
}

function eventEvaluationContext(
    event: NormalizedEvent
): EventEvaluationContext {
    let pending: Promise<LogicalDeviceHint> | undefined;
    return {
        event,
        resolveDevice: async () => {
            if (!('shellyID' in event)) return undefined;
            pending ??= logicalDeviceHint({
                organizationId: event.organizationId,
                externalId: event.shellyID,
                device: 'device' in event ? event.device : undefined
            });
            return pending;
        }
    };
}

async function onTrigger(
    evaluation: RuleEvaluation,
    context: EventEvaluationContext
): Promise<void> {
    const {rule} = evaluation;
    const {event, resolveDevice} = context;
    const fires = new PendingFires();
    for (const match of await collectMatches(evaluation, context)) {
        const device = await resolveDevice();
        if (await maybeDeferOfflineFire(rule, event, match, device)) continue;
        if (await maybeScheduleStateHold(rule, match, device)) continue;
        fires.add(fireMatch(rule, match, false, device));
    }
    await fires.settled();
}

// Composite synthesizes one match; matchAll preserves each matching subject.
async function collectMatches(
    {rule, evaluator}: RuleEvaluation,
    context: EventEvaluationContext
): Promise<MatchResult[]> {
    const {event, resolveDevice} = context;
    // Failed identity must not consume a transition or train the evaluator.
    if (evaluator.stateful) await resolveDevice();
    if (rule.kind === 'composite') {
        const m = await evaluateCompositeRule(rule, context);
        return m ? [m] : [];
    }
    const matches = evaluator.matchAll
        ? evaluator.matchAll(event, rule)
        : [evaluator.match(event, rule)].filter(
              (match): match is MatchResult => match !== null
          );
    const enriched = matches.map((match) =>
        attachVirtualRoleContext(match, event)
    );
    if (rule.kind !== 'flood_alarm' || enriched.length === 0) return enriched;
    return attributeFloodMatches(enriched, event);
}

function fixtureCandidates(): FixtureCandidate[] {
    return DeviceCollector.getAll().map((device) => ({
        shellyID: device.shellyID,
        name: device.info?.name as string | undefined,
        status: (device.status ?? {}) as Record<string, unknown>
    }));
}

// A leak sensor says "wet here"; the fixture that shed the water is a
// different device. Degrade loudly: a failed attribution is logged and
// counted, and the flood alert still fires unattributed — losing a critical
// water alarm because a lookup failed would be the worse outcome.
async function attributeFloodMatches(
    matches: readonly MatchResult[],
    event: NormalizedEvent
): Promise<MatchResult[]> {
    if (!('shellyID' in event)) return [...matches];
    try {
        const excursion = await resolveLeakAttribution(event.shellyID, {
            fixtureCandidates,
            locationIdsOf: async (shellyID) =>
                (
                    await resolveSubjectForEvent(
                        {...event, shellyID},
                        PostgresProvider.callMethod
                    )
                ).locationIds ?? []
        });
        return matches.map((match) => withLeakAttribution(match, excursion));
    } catch (err) {
        Observability.incrementCounter('alert_leak_attribution_failed');
        logger.warn(
            'leak attribution failed for %s: %s',
            event.shellyID,
            describeError(err)
        );
        return [...matches];
    }
}

async function evaluateCompositeRule(
    rule: LoadedAlertRule,
    {event, resolveDevice}: EventEvaluationContext
): Promise<MatchResult | null> {
    if (event.kind !== 'device_status_changed') return null;
    const tree = readCompositeTree(rule.config);
    if (!tree) return null;
    const leafIds = collectLeafRuleIds(tree);
    if (leafIds.length === 0) return null;
    const device = await resolveDevice();
    if (!device) return null;
    const {deviceId} = device;
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

// One org run at a time. A request landing while a run is queued merges into
// it; one landing mid-run merges into ONE trailing rerun, so post-run state is
// never stale. A run carries the union of the changed devices; any request
// without ids widens it to the whole org. SingleFlight tracks the running one.
interface OrgEvaluationRequest {
    reason: 'scope_changed' | 'startup';
    /** null re-checks the whole org. */
    externalIds: Set<string> | null;
}

const orgEvalInflight = new SingleFlight<string, void>('alert_org_eval');
const orgEvalQueued = new Map<string, OrgEvaluationRequest>();
const orgEvalRerunPending = new Map<string, OrgEvaluationRequest>();

export function scheduleOrganizationRuleEvaluation(
    input: OrganizationRuleEvaluationRequest
): void {
    // A whole-org change can be a device replacement, which re-keys open alerts in SQL.
    if (!input.externalIds) invalidateOpenAlertSet(input.organizationId);
    queueOrgEvaluation(input.organizationId, {
        reason: input.reason,
        externalIds: input.externalIds ? new Set(input.externalIds) : null
    });
}

function mergeOrgEvaluation(
    pending: OrgEvaluationRequest | undefined,
    next: OrgEvaluationRequest
): OrgEvaluationRequest {
    if (!pending) return next;
    if (!pending.externalIds || !next.externalIds) {
        return {reason: pending.reason, externalIds: null};
    }
    for (const id of next.externalIds) pending.externalIds.add(id);
    return pending;
}

function queueOrgEvaluation(org: string, request: OrgEvaluationRequest): void {
    const queued = orgEvalQueued.get(org);
    if (queued) {
        Observability.incrementCounter('alert_org_eval_coalesced');
        orgEvalQueued.set(org, mergeOrgEvaluation(queued, request));
        return;
    }
    if (orgEvalInflight.peek(org)) {
        Observability.incrementCounter('alert_org_eval_coalesced');
        orgEvalRerunPending.set(
            org,
            mergeOrgEvaluation(orgEvalRerunPending.get(org), request)
        );
        return;
    }
    orgEvalQueued.set(org, request);
    setImmediate(() => startQueuedOrgEvaluation(org));
}

function startQueuedOrgEvaluation(org: string): void {
    const request = orgEvalQueued.get(org);
    orgEvalQueued.delete(org);
    if (!request) return;
    void runCoalescedOrgEvaluation(org, request).catch((err) => {
        if (isPostgresNotReady(err)) {
            logger.debug(
                'organization alert evaluation skipped org=%s reason=%s: postgres not ready',
                org,
                request.reason
            );
            return;
        }
        Observability.incrementCounter('alert_org_eval_failed');
        logger.error(
            'organization alert evaluation failed org=%s reason=%s: %s',
            org,
            request.reason,
            String(err)
        );
    });
}

async function runCoalescedOrgEvaluation(
    org: string,
    request: OrgEvaluationRequest
): Promise<void> {
    try {
        await orgEvalInflight.run(org, () =>
            evaluateInitialRulesForOrg(org, request)
        );
    } finally {
        const rerun = orgEvalRerunPending.get(org);
        if (rerun) {
            orgEvalRerunPending.delete(org);
            queueOrgEvaluation(org, rerun);
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

/** The devices one initial-evaluation run judges, read once for all rules. */
interface StatusSubjects {
    live: AbstractDevice[];
    stored: StoredDeviceSnapshotRow[];
    promoted: ReadonlyMap<string, ReadonlySet<string>>;
}

interface InitialEvaluationRun {
    subjects: () => Promise<StatusSubjects>;
    /** Only named devices changed; the sweep already re-judges every subject. */
    scoped: boolean;
}

function initialEvaluationRun(
    organizationId: string,
    externalIds?: readonly string[]
): InitialEvaluationRun {
    let loaded: Promise<StatusSubjects> | undefined;
    return {
        scoped: externalIds !== undefined,
        subjects: () => {
            loaded ??= loadStatusSubjects(organizationId, externalIds);
            return loaded;
        }
    };
}

async function loadStatusSubjects(
    organizationId: string,
    externalIds?: readonly string[]
): Promise<StatusSubjects> {
    const live = liveDevicesOf(organizationId, externalIds);
    const stored = await storedDeviceSnapshots(organizationId, externalIds);
    const promoted = externalIds
        ? await promotedComponentsOf(organizationId, gatewayIdsOf(live, stored))
        : promotedComponentsByGateway(stored);
    return {live, stored, promoted};
}

function liveDevicesOf(
    organizationId: string,
    externalIds?: readonly string[]
): AbstractDevice[] {
    const devices = externalIds
        ? externalIds.flatMap((id) => DeviceCollector.getDevice(id) ?? [])
        : DeviceCollector.getAll();
    return devices.filter(
        (device) =>
            EventDistributor.getDeviceOrg(device.shellyID) === organizationId
    );
}

function gatewayIdsOf(
    live: readonly AbstractDevice[],
    stored: readonly StoredDeviceSnapshotRow[]
): string[] {
    const ids = new Set(live.map((device) => device.shellyID));
    for (const row of stored) {
        if (row.kind === BLUETOOTH_KIND) continue;
        if (row.external_id.startsWith('vdev_')) continue;
        ids.add(row.external_id);
    }
    return [...ids];
}

// Same owner source as live gateway events, read in one batch for the run.
async function promotedComponentsOf(
    organizationId: string,
    gatewayExternalIds: readonly string[]
): Promise<Map<string, ReadonlySet<string>>> {
    const routes = await getBluetoothStatusRoutesForGateways(
        gatewayExternalIds.map((gatewayExternalId) => ({
            organizationId,
            gatewayExternalId,
            inventoryVersion:
                EventDistributor.getBluetoothGatewayInventoryVersion(
                    organizationId,
                    gatewayExternalId
                )
        }))
    );
    const out = new Map<string, ReadonlySet<string>>();
    for (const gatewayExternalId of gatewayExternalIds) {
        const owned = routes.get(
            bluetoothGatewayRouteCacheKey(organizationId, gatewayExternalId)
        );
        if (owned?.size) out.set(gatewayExternalId, new Set(owned.keys()));
    }
    return out;
}

async function evaluateInitialRulesForOrg(
    organizationId: string,
    request: OrgEvaluationRequest
): Promise<void> {
    const ids = request.externalIds;
    if (ids?.size === 0) return;
    const run = initialEvaluationRun(
        organizationId,
        ids ? [...ids] : undefined
    );
    for (const rule of await rulesFor(organizationId)) {
        await evaluateLoadedRuleInitialIsolated(rule, run);
    }
}

// One failing rule must not abort the rest of the org rerun; DB-down still does.
async function evaluateLoadedRuleInitialIsolated(
    rule: LoadedAlertRule,
    run: InitialEvaluationRun
): Promise<void> {
    try {
        await evaluateLoadedRuleInitial(rule, run);
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
    await evaluateLoadedRuleInitial(
        rule,
        initialEvaluationRun(input.organizationId)
    );
}

async function evaluateLoadedRuleInitial(
    rule: LoadedAlertRule,
    run: InitialEvaluationRun
): Promise<void> {
    const descriptor = ALERT_RULE_KIND_DESCRIPTOR_BY_KEY[rule.kind];
    if (!descriptor?.initialEvaluation) return;

    if (
        descriptor.evaluationMode === 'state' ||
        descriptor.evaluationMode === 'composite'
    ) {
        await evaluateCurrentStatusRule(rule, run.subjects);
        return;
    }

    if (
        !run.scoped &&
        (descriptor.evaluationMode === 'absence' ||
            descriptor.evaluationMode === 'window')
    ) {
        const sweep = await import('./alert/RuleSweep.js');
        await sweep.runSweepForRules(rule.organizationId, Date.now(), [
            rule.id
        ]);
    }
}

async function evaluateCurrentStatusRule(
    rule: LoadedAlertRule,
    subjects: () => Promise<StatusSubjects>
): Promise<void> {
    const evaluator = getEvaluator(rule.kind);
    if (!evaluator?.triggerKinds.includes('device_status_changed')) return;

    const seen = new Set<string>();
    const fires = new PendingFires();
    const {live, stored, promoted} = await subjects();
    for (const device of live) {
        seen.add(device.shellyID);
        const promotedAway = promoted.get(device.shellyID);
        const event: NormalizedEvent = {
            kind: 'device_status_changed',
            organizationId: rule.organizationId,
            shellyID: device.shellyID,
            status: (device.status ?? {}) as Record<string, unknown>,
            device,
            ...(promotedAway ? {promotedAway} : {})
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
        const subject = await subjectForEvent(event, [rule.scope]);
        if (!matchesScope(rule.scope, subject)) continue;
        const context: EventEvaluationContext = {
            event,
            resolveDevice: async () => hint
        };
        const matches = await collectMatches({rule, evaluator}, context);
        if (matches.length > 0) {
            for (const match of matches) {
                if (await maybeScheduleStateHold(rule, match, hint)) continue;
                fires.add(fireMatch(rule, match, false, hint));
            }
            continue;
        }
        if (evaluator.clearKinds?.includes('device_status_changed')) {
            await onClear({rule, evaluator}, context);
        }
    }

    for (const row of stored) {
        if (seen.has(row.external_id)) continue;
        const snapshot = deviceSnapshotFromStoredRow(row);
        const hint = {deviceId: row.id, externalId: row.external_id};
        const status = snapshot.status;
        const promotedAway = promoted.get(row.external_id);
        const event: NormalizedEvent = {
            kind: 'device_status_changed',
            organizationId: rule.organizationId,
            shellyID: row.external_id,
            status,
            device: snapshot,
            ...(promotedAway ? {promotedAway} : {})
        };
        const subject = await subjectForEvent(event, [rule.scope]);
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
        const context: EventEvaluationContext = {
            event,
            resolveDevice: async () => hint
        };
        const matches = await collectMatches({rule, evaluator}, context);
        if (matches.length > 0) {
            for (const match of matches) {
                if (await maybeScheduleStateHold(rule, match, hint)) continue;
                fires.add(fireMatch(rule, match, false, hint));
            }
            continue;
        }
        if (evaluator.clearKinds?.includes('device_status_changed')) {
            await onClear({rule, evaluator}, context);
        }
    }
    await fires.settled();
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

interface FireProgress {
    stage: 'prepare' | 'write' | 'route' | 'record' | 'committed';
}

// --- Fire writer ---------------------------------------------------------

// A fire after prepare: everything its transaction needs, read beforehand.
interface QueuedFire {
    readonly rule: LoadedAlertRule;
    readonly match: MatchResult;
    readonly device: LogicalDeviceHint | undefined;
    readonly recipientUserIds: readonly string[];
    readonly progress: FireProgress;
}

interface WrittenFire {
    instance: UpsertedInstance;
    changed: boolean;
    deliver: boolean;
}

// The default alert connection ceiling; the second only for an overdue batch.
const ALERT_FIRE_MAX_FLUSHES = 2;

const fireWriter = new FireBatchWriter<QueuedFire, WrittenFire | undefined>({
    maxRows: tuning.alert.fireBatchMaxRows,
    tickMs: tuning.alert.fireBatchTickMs,
    maxFlushes: ALERT_FIRE_MAX_FLUSHES,
    observer: alertFireMetrics,
    // Background alert work whichever caller's timer started the flush.
    commit: (fires) =>
        runAsBackgroundDbWork(() =>
            runAsDbWorkload('alert', () => writeFireBatch(fires))
        )
});
watchAlertFireQueue(fireWriter);

/** Commits queued alert fires now; shutdown calls it before the pool closes. */
export function drainAlertFires(): Promise<void> {
    return fireWriter.drain();
}

// Fires handed over together share the writer's next batch; awaiting each in
// turn would cost a tick per fire. The first failure is rethrown at the end.
class PendingFires {
    readonly #outcomes: Array<Promise<{error: unknown} | undefined>> = [];

    add(fire: Promise<void>): void {
        this.#outcomes.push(
            fire.then(
                () => undefined,
                (error: unknown) => ({error})
            )
        );
    }

    async settled(): Promise<void> {
        for (const outcome of await Promise.all(this.#outcomes)) {
            if (outcome) throw outcome.error;
        }
    }
}

// One transaction for the whole batch; every write of a fire passes its txId.
async function writeFireBatch(
    fires: readonly QueuedFire[]
): Promise<Array<WrittenFire | undefined>> {
    return withPostgresTransaction(async (_txId, ctx) => {
        const written: Array<WrittenFire | undefined> = [];
        for (const fire of fires) written.push(await writeFire(fire, ctx));
        return written;
    });
}

// The alert row, its inbox entries, its delivery jobs and its notice time
// commit together: after a separate commit, a lost write was never replayed,
// because the retry reports changed=false.
async function writeFire(
    fire: QueuedFire,
    ctx: PostgresTxContext
): Promise<WrittenFire | undefined> {
    const {rule, progress} = fire;
    progress.stage = 'write';
    const instance = await upsertInstance(
        rule,
        fire.match,
        true,
        fire.device,
        ctx
    );
    if (!instance) return undefined;
    // Unchanged re-fire: no inbox add, no WS emit.
    const changed = rowChanged(instance);
    if (changed) {
        const kind = instance.was_created ? 'alert_created' : 'alert_updated';
        const inserted = await addInboxItems(rule, instance, kind, {
            userIds: fire.recipientUserIds,
            txId: ctx.txId
        });
        // Leaves the database, so it must not run if the commit fails.
        ctx.onCommit(() => emitInsertedInboxItems(inserted));
    }
    const deliver = shouldDeliverAfterCooldown(
        rule,
        instance,
        getNotifiedFallbackMs(identityOf(instance))
    );
    if (deliver) {
        progress.stage = 'route';
        await routeAlertNotification({rule, instance, tx: ctx});
        progress.stage = 'record';
        await recordNotified(instance, ctx);
    }
    return {instance, changed, deliver};
}

// The caller logs the error; this counts each failed attempt once, by the
// step that threw. Failures after the commit are not fire failures.
async function fireMatch(
    rule: LoadedAlertRule,
    match: MatchResult,
    isCanonical = false,
    device?: LogicalDeviceHint
): Promise<void> {
    const progress: FireProgress = {stage: 'prepare'};
    try {
        await fireMatchSteps(rule, match, isCanonical, device, progress);
    } catch (err) {
        if (progress.stage !== 'committed') {
            Observability.incrementLabeledCounter('alert_fire_failed', {
                stage: progress.stage
            });
        }
        throw err;
    }
}

async function fireMatchSteps(
    rule: LoadedAlertRule,
    match: MatchResult,
    isCanonical: boolean,
    device: LogicalDeviceHint | undefined,
    progress: FireProgress
): Promise<void> {
    // Outside its hours the rule stays quiet. Gated here, not at dispatch, so
    // evaluators still see every event and keep their baselines — and so a
    // recovery can still clear an alert raised inside the window (onClear does
    // not come through here).
    if (!ruleIsActiveAt(rule.activeWindow, new Date())) {
        Observability.incrementCounter(
            'alert_fire_suppressed_by_active_window'
        );
        return;
    }
    const enrichedMatch = await enrichVirtualAlertMatch(
        rule.organizationId,
        match
    );
    const templatedMatch = applyRuleTemplates(rule, enrichedMatch);
    // Canonicalized and recipients read before the transaction opens: a read
    // on a second connection while the transaction is held costs a pool slot,
    // and a full pool of such transactions waits on itself.
    const canonicalMatch = isCanonical
        ? templatedMatch
        : await canonicalizeAlertMatch(
              rule.organizationId,
              rule.id,
              templatedMatch,
              device
          );
    const stateKey = alertTransitionKey(
        rule.organizationId,
        rule.id,
        canonicalMatch.fingerprintV2
    );
    const known = readAlertState(stateKey);
    if (
        known?.open &&
        !known.latched &&
        known.request === upsertRequestKey(rule, canonicalMatch) &&
        !repeatNoticeMayBeDue(rule, canonicalMatch.fingerprintV2)
    ) {
        // Same request on a known open alert: the database would not change.
        Observability.incrementCounter('alert_fire_unchanged_skipped');
        await scheduleMotionClearIfApplicable(rule, match.fingerprintV2);
        return;
    }
    const recipientUserIds = await ruleRecipientUsers(rule);
    progress.stage = 'write';
    const written = await fireWriter.write(stateKey, {
        rule,
        match: canonicalMatch,
        device,
        recipientUserIds,
        progress
    });
    progress.stage = 'committed';
    if (!written) return;
    const {instance, changed, deliver} = written;
    if (deliver) {
        await disableIfTriggerOnce(rule);
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

// A first-ever fire notifies; a re-fire waits out cooldownSec.
//
// "Never notified before" is the test, not "this row is new". A new row is not
// a new alert: at the default dedupeWindowSec of 0 every resolve-then-refire
// inserts one, and short-circuiting on was_created meant cooldown was dead
// unless the operator had also set a dedupe window — one control silently
// switching another on. lastNotifiedMs carries the memory across those rows.
// Cooldown 0 notifies on change only: a new alert, a reopen, a severity or
// title change. Above 0, an unchanged alert repeats after the cooldown.
export function shouldDeliverAfterCooldown(
    rule: LoadedAlertRule,
    instance: UpsertedInstance,
    lastNotifiedMs?: number
): boolean {
    if (rule.cooldownSec <= 0) return rowChanged(instance);
    const dbLast = instance.last_notified_at
        ? new Date(instance.last_notified_at).getTime()
        : 0;
    const last = Math.max(
        Number.isFinite(dbLast) ? dbLast : 0,
        lastNotifiedMs ?? 0
    );
    if (last === 0) return true;
    return Date.now() - last >= rule.cooldownSec * 1000;
}

// An unchanged re-fire can only notify once its cooldown has passed; an
// unknown last notice time sends it to the database to find out.
function repeatNoticeMayBeDue(
    rule: LoadedAlertRule,
    fingerprint: string
): boolean {
    if (rule.cooldownSec <= 0) return false;
    const last = getNotifiedFallbackMs({ruleId: rule.id, fingerprint});
    return last === undefined || Date.now() - last >= rule.cooldownSec * 1000;
}

/**
 * "Tell me once, then stop."
 *
 * Runs after the notification, never before: a rule that disabled itself and
 * then failed to deliver would be silently spent. The write is best effort —
 * a rule that notified is a rule that did its job, and an error here must not
 * fail the evaluation pass or hold up the rest of the fleet.
 */
export async function disableIfTriggerOnce(
    rule: LoadedAlertRule
): Promise<void> {
    if (!rule.triggerOnce) return;
    try {
        await PostgresProvider.callMethod(
            'notifications.fn_alert_rule_update',
            {
                p_organization_id: rule.organizationId,
                p_id: rule.id,
                p_enabled: false
            }
        );
        Observability.incrementCounter(
            'alert_rule_disabled_after_trigger_once'
        );
        logger.info(
            'rule %d disabled after firing once as configured',
            rule.id
        );
    } catch (err) {
        Observability.incrementCounter('alert_trigger_once_disable_errors');
        logger.error(
            'could not disable trigger-once rule %d: %s',
            rule.id,
            String(err)
        );
    }
}

function identityOf(instance: UpsertedInstance): AlertIdentity {
    return {ruleId: instance.rule_id, fingerprint: instance.fingerprint};
}

// In the alert transaction: a process that sees the delivery also sees the
// notice time, so a re-fire elsewhere waits out the cooldown.
async function recordNotified(
    instance: UpsertedInstance,
    tx: PostgresTxContext
): Promise<void> {
    await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_record_notification',
        {p_id: instance.id},
        tx.txId
    );
    // A later re-fire may land on a brand new row, so the identity-keyed
    // memory has to hold the time too.
    const identity = identityOf(instance);
    tx.onCommit(() => recordNotifiedFallback(identity));
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
    const rule =
        (await rulesFor(payload.organizationId)).find(
            (r) => r.id === payload.ruleId
        ) ?? null;
    if (!rule) return;
    if (rule.kind !== 'device_offline') return;
    // Same judgement as the sweep: a device heard again, or one still inside
    // its sleep or quiet time, does not fire; the sweep reschedules the latter.
    const [row] = await storedDevicePresence(
        payload.organizationId,
        PostgresProvider,
        [externalId]
    );
    if (!row) return;
    const live = DeviceCollector.getDevice(externalId);
    const offlineForSec = offlineForSecOf(rule);
    const reach = deviceReachability({
        row,
        live,
        bluetooth: (
            await bluetoothDevicesForPresence(payload.organizationId, [row])
        ).get(externalId),
        collector: DeviceCollector,
        offlineForSec,
        now: Date.now()
    });
    if (reach.state !== 'offline') return;
    const match = buildDeviceOfflineMatch(
        rule.id,
        rule.name,
        externalId,
        row.name ?? (live?.info?.name as string | undefined),
        {
            offlineForSec: offlineForSec ?? undefined,
            offlineSince: new Date(reach.lastSeenMs).toISOString(),
            reason: reach.reason,
            source: 'presence_store'
        }
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
    await fireWriter.settled(
        alertTransitionKey(
            params.organizationId,
            params.ruleId,
            params.fingerprint
        )
    );
    Observability.incrementCounter('alert_resolution_calls_total');
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_instance_auto_resolve',
        {
            p_organization_id: params.organizationId,
            p_rule_id: params.ruleId,
            p_fingerprint_v2: params.fingerprint
        }
    );
    const instance = result?.rows?.[0] as UpsertedInstance | undefined;
    rememberClosedAlertInstance(
        params.organizationId,
        params.ruleId,
        params.fingerprint
    );
    noteWrittenInstance({...params, instance});
    if (!instance) return;
    publishAlertStateChanged(
        params.organizationId,
        alertTransitionKey(
            params.organizationId,
            params.ruleId,
            params.fingerprint
        )
    );
    Observability.incrementCounter('alert_resolution_transitions_total');
    const rule =
        (await rulesFor(params.organizationId)).find(
            (r) => r.id === params.ruleId
        ) ?? null;
    if (rule) {
        await addResolvedInboxItems(rule, instance);
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

// Live state of the open instance for this fingerprint, undefined when none is open.
// The org set answers "none open"; an open one is read, since its state decides the hold.
async function openInstanceState(
    rule: LoadedAlertRule,
    fingerprintV2: string
): Promise<string | undefined> {
    const scope = {organizationId: rule.organizationId, ruleId: rule.id};
    const known = await lookupOpenAlert(scope, fingerprintV2);
    if (known.kind === 'closed') return undefined;
    const row = await readOpenInstanceForEvent(scope, fingerprintV2);
    return row?.state;
}

interface OpenInstanceScope {
    organizationId: string;
    ruleId: number;
}

// A rule edit closes in-flight reads; a one-time clear such as device_online
// would be lost, so read once more while the rule still exists.
async function readOpenInstanceForEvent(
    scope: OpenInstanceScope,
    fingerprint: string
): Promise<OpenInstanceRow | undefined> {
    try {
        return await readOpenInstance(scope, fingerprint);
    } catch (err) {
        if (!(err instanceof AlertReadAbortedError)) throw err;
        return rereadAbortedOpenInstance(scope, fingerprint, err);
    }
}

async function rereadAbortedOpenInstance(
    scope: OpenInstanceScope,
    fingerprint: string,
    aborted: AlertReadAbortedError
): Promise<OpenInstanceRow | undefined> {
    if (!started) throw aborted;
    const rules = await rulesFor(scope.organizationId);
    if (!rules.some((rule) => rule.id === scope.ruleId)) throw aborted;
    return readOpenInstance(scope, fingerprint);
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
    // The match's shellyID is not always the event's own device — a virtual device's
    // status carries its source's id, and a component rule matches on that. When it
    // differs, the device is still in DeviceCollector's Map, so ask the Map rather
    // than the database. Asking with no device at all made this the busiest remaining
    // caller of fn_resolve_device_id: 8,190 queries in 120 seconds, because
    // component_threshold and component_state with a forSec are the dominant rule
    // kinds here and every one of them lands on this line.
    const device =
        deviceHint?.externalId === shellyID
            ? deviceHint
            : await logicalDeviceHint({
                  organizationId: rule.organizationId,
                  externalId: shellyID,
                  device: DeviceCollector.getDevice(shellyID) ?? undefined
              });
    const canonicalMatch = await canonicalizeAlertMatch(
        rule.organizationId,
        rule.id,
        match,
        device
    );
    if (stateHoldPending.has(canonicalMatch.fingerprintV2)) return true;
    // The hold map forgets a fired key, so only the row tells a first entry from a repeat.
    if (
        alertAlreadyFiring(
            await openInstanceState(rule, canonicalMatch.fingerprintV2)
        )
    ) {
        return false;
    }
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
// The device a hold re-checks: the live one, else the stored snapshot the
// sweep and the preview use. A promoted BLU device or a composed device is
// never live, and "door open for 5 minutes" must still fire for it.
async function deviceForHold(
    organizationId: string,
    externalId: string
): Promise<AbstractDevice | undefined> {
    const live = DeviceCollector.getDevice(externalId);
    if (live) return live;
    const [row] = await storedDeviceSnapshots(organizationId, [externalId]);
    if (!row) return undefined;
    const snapshot = deviceSnapshotFromStoredRow(row);
    return Object.keys(snapshot.status ?? {}).length > 0 ? snapshot : undefined;
}

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
    const device = await deviceForHold(payload.organizationId, externalId);
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
        (
            await collectMatches(
                {rule, evaluator},
                eventEvaluationContext(event)
            )
        ).map((match) =>
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
    {rule, evaluator}: RuleEvaluation,
    context: EventEvaluationContext
): Promise<void> {
    const {event, resolveDevice} = context;
    await cancelPendingOfflineFireIfApplicable(rule, context);
    const matches = clearMatches(evaluator, event, rule);
    if (matches.length === 0) return;
    if (!rule.autoResolve && stateHoldPending.size === 0) return;
    const device = await resolveDevice();
    for (const {fingerprintV2} of matches) {
        if (device) {
            await cancelStateHoldForFingerprint(rule, fingerprintV2, device);
        }
    }
    if (!rule.autoResolve) return;
    for (const {fingerprintV2, cleared} of matches) {
        await resolveAlertFingerprint({rule, fingerprintV2, device, cleared});
    }
}

// All recovered subjects; falls back to the single matchClear.
function clearMatches(
    evaluator: Evaluator,
    event: NormalizedEvent,
    rule: LoadedAlertRule
): readonly ClearMatch[] {
    const all = evaluator.matchClearAll?.(event, rule);
    if (all) return all;
    const single = evaluator.matchClear?.(event, rule);
    return single ? [single] : [];
}

export async function resolveFingerprint(
    rule: LoadedAlertRule,
    fingerprintV2: string,
    device?: LogicalDeviceHint
): Promise<void> {
    return resolveAlertFingerprint({rule, fingerprintV2, device});
}

interface AlertResolutionRequest {
    rule: LoadedAlertRule;
    fingerprintV2: string;
    device?: LogicalDeviceHint;
    reads?: OpenInstanceReadBatch;
    cleared?: ClearedReading;
}

export interface PreparedAlertResolution {
    rule: LoadedAlertRule;
    persistedFingerprint: string;
    open: Promise<boolean>;
    cleared?: ClearedReading;
}

export function createSweepAlertResolver(
    rule: LoadedAlertRule,
    options: {deferReads?: boolean} = {}
) {
    const reads = new OpenInstanceReadBatch({
        organizationId: rule.organizationId,
        ruleId: rule.id
    });
    return {
        assertActive: () => reads.assertActive(),
        close: () => reads.close(),
        dispatch: () => reads.dispatch(),
        prepare: (fingerprintV2: string, device?: LogicalDeviceHint) =>
            prepareAlertResolution({
                rule,
                fingerprintV2,
                device,
                reads,
                deferDispatch: options.deferReads === true
            }),
        resolvePrepared: (prepared: PreparedAlertResolution) =>
            completeAlertResolution(prepared, reads),
        resolve: (fingerprintV2: string, device?: LogicalDeviceHint) =>
            resolveAlertFingerprint({rule, fingerprintV2, device, reads})
    };
}

async function resolveAlertFingerprint({
    rule,
    fingerprintV2,
    device,
    reads,
    cleared
}: AlertResolutionRequest): Promise<void> {
    const prepared = await prepareAlertResolution({
        rule,
        fingerprintV2,
        device,
        reads,
        cleared
    });
    await completeAlertResolution(prepared, reads);
}

async function prepareAlertResolution({
    rule,
    fingerprintV2,
    device,
    reads,
    cleared,
    deferDispatch = false
}: AlertResolutionRequest & {
    deferDispatch?: boolean;
}): Promise<PreparedAlertResolution> {
    reads?.assertActive();
    const persistedFingerprint = await canonicalAlertFingerprint(
        rule.organizationId,
        rule.id,
        fingerprintV2,
        device
    );
    const open = alertFingerprintIsOpen({
        organizationId: rule.organizationId,
        ruleId: rule.id,
        fingerprint: persistedFingerprint,
        reads,
        deferDispatch
    });
    // The wave may dispatch before completion attaches its await.
    void open.catch(() => undefined);
    return {
        rule,
        persistedFingerprint,
        open,
        cleared
    };
}

async function completeAlertResolution(
    prepared: PreparedAlertResolution,
    reads?: OpenInstanceReadBatch
): Promise<void> {
    const {rule, persistedFingerprint} = prepared;
    const key = alertTransitionKey(
        rule.organizationId,
        rule.id,
        persistedFingerprint
    );
    // A fire of this alert still in the writer is older than this clear.
    await fireWriter.settled(key);
    reads?.assertActive();
    if (!(await prepared.open) && !knownOpen(key)) {
        Observability.incrementCounter(
            'alert_resolution_normal_transition_suppressed_total'
        );
        return;
    }
    reads?.assertActive();
    await alertResolutionFlights.run(key, async () => {
        reads?.assertActive();
        Observability.incrementCounter('alert_resolution_calls_total');
        const result = await PostgresProvider.callMethod(
            'notifications.fn_alert_instance_auto_resolve',
            {
                p_organization_id: rule.organizationId,
                p_rule_id: rule.id,
                p_fingerprint_v2: persistedFingerprint,
                p_context: prepared.cleared
                    ? JSON.stringify(prepared.cleared)
                    : null
            }
        );
        const instance = result?.rows?.[0] as UpsertedInstance | undefined;
        rememberClosedAlertInstance(
            rule.organizationId,
            rule.id,
            persistedFingerprint
        );
        noteWrittenInstance({
            organizationId: rule.organizationId,
            ruleId: rule.id,
            fingerprint: persistedFingerprint,
            instance
        });
        if (!instance) return;
        publishAlertStateChanged(rule.organizationId, key);
        Observability.incrementCounter('alert_resolution_transitions_total');
        if (isSilentEvaluationLifecycle(instance)) {
            emitAlertWs('Alert.Resolved', instance);
            return;
        }
        await addResolvedInboxItems(rule, instance);
        await routeAlertNotification({rule, instance});
        emitAlertWs('Alert.Resolved', instance);
    });
}

async function alertFingerprintIsOpen({
    organizationId,
    ruleId,
    fingerprint,
    reads,
    deferDispatch = false
}: {
    organizationId: string;
    ruleId: number;
    fingerprint: string;
    reads?: OpenInstanceReadBatch;
    deferDispatch?: boolean;
}): Promise<boolean> {
    const key = alertTransitionKey(organizationId, ruleId, fingerprint);
    const cached = readAlertState(key);
    if (cached) {
        Observability.incrementCounter(
            'alert_transition_state_cache_hits_total'
        );
        return cached.open;
    }
    Observability.incrementCounter('alert_transition_state_cache_misses_total');

    // A sweep wave queues its reads before it dispatches, so it must not wait.
    const scope = {organizationId, ruleId};
    const known = reads
        ? peekOpenAlert(scope, fingerprint)
        : await lookupOpenAlert(scope, fingerprint);
    if (known.kind !== 'unknown') {
        // A local transition that landed during the load is newer than it.
        return readAlertState(key)?.open ?? known.kind === 'open';
    }

    if (reads) {
        const row = await (deferDispatch
            ? reads.queue(fingerprint)
            : reads.read(fingerprint));
        // A local transition that landed during the batch is newer than it.
        const newer = readAlertState(key);
        if (newer) return newer.open;
        if (row !== undefined) {
            rememberOpenAlertInstance(organizationId, ruleId, fingerprint);
        } else {
            rememberClosedAlertInstance(organizationId, ruleId, fingerprint);
        }
        return row !== undefined;
    }

    return alertTransitionLoads.run(key, async () => {
        const open =
            (await readOpenInstanceForEvent(
                {organizationId, ruleId},
                fingerprint
            )) !== undefined;
        // A local fire or resolve can land while the read is in flight.
        // Prefer that newer transition over the older read result.
        const newer = readAlertState(key);
        if (newer) return newer.open;
        if (open)
            rememberOpenAlertInstance(organizationId, ruleId, fingerprint);
        else rememberClosedAlertInstance(organizationId, ruleId, fingerprint);
        return open;
    });
}

export function __resetAlertTransitionStateForTests(): void {
    alertInstanceTransitionState.clear();
    clearOpenAlertSet();
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
    {event, resolveDevice}: EventEvaluationContext
): Promise<void> {
    if (rule.kind !== 'device_offline') return;
    if (event.kind !== 'device_online') return;
    if (offlineForSecOf(rule) === null) return;
    const device = await resolveDevice();
    if (!device) return;
    const jobKey = OutboxWorker.offlineFireJobKey(rule.id, device.deviceId);
    if (!(await offlineFireMayBePending(rule.organizationId, jobKey))) return;
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
        'notifications.fn_alert_instance_get_batch_v2',
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
    const profile = await getOrganizationProfile(organizationId);
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
        const payload = buildAlertPayload(rule, a, {
            locale: profile.localeDefault,
            timeZone: profile.timezoneDefault
        });
        payload.template = templateByRuleId.get(rule.id) ?? null;
        return payload;
    };
    return {rows, payloadFor};
}

function firedAtMs(payload: DeliveryPayload): number {
    const ms = Date.parse(payload.firedAt);
    return Number.isNaN(ms) ? 0 : ms;
}

// Newest fire first; ties break on the newer id so two renders never disagree.
function byFiredAtDescending(a: DeliveryPayload, b: DeliveryPayload): number {
    const byTime = firedAtMs(b) - firedAtMs(a);
    return byTime !== 0 ? byTime : (b.alertId ?? 0) - (a.alertId ?? 0);
}

// Every channel renders the leader first, so the batch is ordered once here: newest leads.
export function buildEnvelope(payloads: DeliveryPayload[]): DeliveryPayload {
    const ordered = [...payloads].sort(byFiredAtDescending);
    const [leader, ...siblings] = ordered;
    return {
        ...leader,
        siblings: siblings.length > 0 ? siblings : undefined,
        aggregate: siblings.length > 0 ? buildAggregate(ordered) : undefined
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

export async function __handleGroupFlushForTests(
    groupId: number
): Promise<void> {
    await handleGroupFlush(groupId);
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

// Component types a status event carries, minus readings a BLU device owns.
function statusComponentTypes(event: NormalizedEvent): Set<string> | null {
    if (event.kind !== 'device_status_changed') return null;
    const types = new Set<string>();
    for (const key of Object.keys(event.status)) {
        if (event.promotedAway?.has(key)) continue;
        types.add(key.split(':')[0] ?? key);
    }
    return types;
}

const ruleInputTypes = new WeakMap<
    LoadedAlertRule,
    ReadonlySet<string> | null
>();

// Rule-engine routing: a rule that declares its inputs only sees events carrying one.
function readsAnyOf(
    evaluator: Evaluator,
    rule: LoadedAlertRule,
    eventTypes: ReadonlySet<string>
): boolean {
    if (!evaluator.inputTypes) return true;
    let inputs = ruleInputTypes.get(rule);
    if (inputs === undefined) {
        inputs = evaluator.inputTypes(rule);
        ruleInputTypes.set(rule, inputs);
    }
    if (!inputs) return true;
    for (const type of inputs) if (eventTypes.has(type)) return true;
    return false;
}

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
    if (!rules || rules.length === 0) return;
    const eventTypes = statusComponentTypes(event);
    const eligible = rules.flatMap((rule) => {
        const evaluator = getEvaluator(rule.kind);
        if (!evaluator) return [];
        const handlesTrigger = evaluator.triggerKinds.includes(event.kind);
        const handlesClear =
            evaluator.clearKinds?.includes(event.kind) ?? false;
        if (!handlesTrigger && !handlesClear) return [];
        if (eventTypes && !readsAnyOf(evaluator, rule, eventTypes)) return [];
        return [{rule, evaluator, handlesTrigger, handlesClear}];
    });
    if (eligible.length === 0) return;
    // Subject resolver hits the DB. A transient failure must NOT silence
    // every rule — fall back to an empty subject so wildcard-scope rules
    // still fire. Scoped rules (groupIds/locationIds/tagIds) will not
    // match an empty subject, which is fail-closed for them.
    const subject = await subjectForEvent(
        event,
        eligible.map(({rule}) => rule.scope)
    ).catch((err) => {
        Observability.incrementCounter('alert_subject_resolve_failed');
        logger.warn(
            'subjectForEvent failed for event kind=%s org=%s: %s',
            event.kind,
            event.organizationId,
            String(err)
        );
        return {} as Awaited<ReturnType<typeof subjectForEvent>>;
    });
    const context = eventEvaluationContext(event);
    // One slow rule must not pin the event-loop slot.
    const RULE_DISPATCH_TIMEOUT_MS = 30_000;
    await runBoundedParallel({
        tasks: eligible,
        concurrency: tuning.alert.dispatchConcurrency,
        perTaskTimeoutMs: RULE_DISPATCH_TIMEOUT_MS,
        label: 'alert-dispatch',
        run: async ({rule, evaluator, handlesTrigger, handlesClear}) => {
            if (!matchesScope(rule.scope, subject)) return;

            try {
                if (handlesTrigger) await onTrigger({rule, evaluator}, context);
                if (handlesClear) await onClear({rule, evaluator}, context);
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
// Alert work is capped on the shared pool (FM_DB_ALERT_MAX_CONNECTIONS).
export function ingestEvent(event: NormalizedEvent): Promise<void> {
    return runAsDbWorkload('alert', () => ingestEventAsAlertWork(event));
}

async function ingestEventAsAlertWork(event: NormalizedEvent): Promise<void> {
    if (!started) return;
    await dispatch(event);
    if (
        event.kind === 'device_status_changed' &&
        !event.shellyID.startsWith('vdev_')
    ) {
        for (const projected of await projectVirtualStatusEvents(event)) {
            await dispatch(projected);
        }
    }
}

export async function projectVirtualStatusEvents(
    sourceEvent: Extract<NormalizedEvent, {kind: 'device_status_changed'}>
): Promise<NormalizedEvent[]> {
    const getSourceSnapshot = (externalId: string): SourceSnapshot | null => {
        const device = DeviceCollector.getDevice(externalId);
        if (device) {
            return {
                presence: device.online ? 'online' : 'offline',
                status: (device.status ?? null) as Record<
                    string,
                    unknown
                > | null
            };
        }
        if (externalId === sourceEvent.shellyID) {
            return {presence: 'online', status: sourceEvent.status};
        }
        return null;
    };
    const {bindings} = await projectionBindingsForSource(
        sourceEvent.organizationId,
        sourceEvent.shellyID,
        listVirtualEntityBindings
    );
    if (bindings.length === 0) return [];
    const all = await resolveVirtualEntityBindings(bindings, {
        getSourceSnapshot
    });
    const byDevice = new Map<string, VirtualEntityResolution[]>();
    for (const entity of all) {
        const bucket = byDevice.get(entity.deviceExternalId) ?? [];
        bucket.push(entity);
        byDevice.set(entity.deviceExternalId, bucket);
    }
    const projected: NormalizedEvent[] = [];
    for (const [externalId, entities] of byDevice) {
        const status: Record<string, unknown> = {};
        const roles: Record<string, unknown> = {};
        const componentIds = assignVirtualComponentIds(
            entities.map((entity) => ({
                roleKey: entity.roleKey,
                sourceComponentKey: entity.sourceComponentKey,
                entityType: entity.entity.type
            }))
        );
        for (const entity of entities) {
            const componentId =
                componentIds.get(entity.roleKey) ?? entity.entity.properties.id;
            status[`${entity.entity.type}:${componentId}`] = entity.status;
            status[entity.entity.id] = entity.status;
            roles[entity.roleKey] = {
                available: entity.online,
                value: entity.status,
                source: {
                    deviceExternalId: entity.sourceDeviceExternalId,
                    componentKey: entity.sourceComponentKey
                }
            };
        }
        status.virtualdevice = {roles};
        const device = virtualAlertDeviceSnapshot(externalId, entities, status);
        projected.push({
            kind: 'device_status_changed',
            organizationId: sourceEvent.organizationId,
            shellyID: externalId,
            status,
            device
        });
    }
    return projected;
}

export function virtualAlertDeviceSnapshot(
    externalId: string,
    entities: readonly VirtualEntityResolution[],
    status: Record<string, unknown>
): AbstractDevice {
    const online = entities.some((entity) => entity.online);
    return {
        id: entities[0]?.deviceListId ?? 0,
        shellyID: externalId,
        status,
        info: {name: externalId},
        entities: entities.map((entity) => entity.entity),
        profile: {flags: {isBattery: false}},
        presence: online ? 'online' : 'offline',
        online
    } as unknown as AbstractDevice;
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

export interface SystemHealthEvent {
    status: 'firing' | 'resolved';
    check: string;
    title: string;
    message: string;
    metric: string;
    value: number;
    action: string;
}

export function reportSystemHealth(
    organizationId: string,
    event: SystemHealthEvent
): Promise<void> {
    return ingestEvent({kind: 'system_health', organizationId, ...event});
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

function subscribe(
    eventName: string,
    handler: (e: unknown, data?: event_data_t) => void
): void {
    const id = EventDistributor.addEventListener(
        CommandSender.INTERNAL,
        eventName,
        {},
        (event, data) => handler(event, data)
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

export async function alertEventFromStatus(
    raw: unknown,
    data?: event_data_t
): Promise<NormalizedEvent | null> {
    const params = (
        raw as {
            params?: {shellyID?: string; status?: Record<string, unknown>};
        }
    )?.params;
    const shellyID = params?.shellyID;
    const status = params?.status;
    if (!shellyID || !status) return null;
    const route = data?.bluetoothRoute;
    if (route) {
        const device = bluetoothAlertDevice(route, {
            presence: 'online',
            status
        });
        return {
            kind: 'device_status_changed',
            organizationId: route.organizationId,
            shellyID,
            device,
            deviceName: device.info?.name as string | undefined,
            status
        };
    }
    const organizationId = EventDistributor.getDeviceOrg(shellyID);
    if (!organizationId) {
        Observability.incrementCounter('alert_event_dropped_unknown_org');
        return null;
    }
    const device = DeviceCollector.getDevice(shellyID) ?? undefined;
    const bluetoothIdentity = status.bluetoothdevice;
    const bluetoothRecord =
        bluetoothIdentity &&
        typeof bluetoothIdentity === 'object' &&
        !Array.isArray(bluetoothIdentity)
            ? (bluetoothIdentity as Record<string, unknown>)
            : undefined;
    const bluetoothName =
        typeof bluetoothRecord?.name === 'string'
            ? bluetoothRecord.name
            : undefined;
    const deviceName =
        typeof device?.info?.name === 'string'
            ? device.info.name
            : bluetoothName;
    const promotedAway = device
        ? await promotedGatewayComponents(organizationId, shellyID)
        : undefined;
    return {
        kind: 'device_status_changed',
        organizationId,
        shellyID,
        device,
        deviceName,
        status,
        ...(promotedAway?.size ? {promotedAway} : {})
    };
}

const promotedKeysByRoutes = new WeakMap<
    ReadonlyMap<string, unknown>,
    ReadonlySet<string>
>();

// The gateway's readings an added BLU device owns; cached per route snapshot.
async function promotedGatewayComponents(
    organizationId: string,
    gatewayExternalId: string
): Promise<ReadonlySet<string>> {
    const routes = await ShellyEvents.promotedStatusRoutesForGateway(
        organizationId,
        gatewayExternalId
    );
    let keys = promotedKeysByRoutes.get(routes);
    if (!keys) {
        keys = new Set(routes.keys());
        promotedKeysByRoutes.set(routes, keys);
    }
    return keys;
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
    if (!alertStateSignalsSubscribed) {
        alertStateSignalsSubscribed = true;
        fireAndForget('onAnyOrg.alert-state-changed', () =>
            onAnyOrg(applyAlertStateSignal)
        );
    }

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
    subscribe('Shelly.Status', (raw, data) => {
        void alertEventFromStatus(raw, data)
            .then((e) => (e ? ingestEvent(e) : undefined))
            .catch(logIngestError);
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
    invalidateOpenInstanceReadBatches();
    if (!started) return;
    for (const id of listenerIds) {
        EventDistributor.removeEventListener(id, '');
    }
    listenerIds.length = 0;
    deviceEventUnsubscribe?.();
    deviceEventUnsubscribe = undefined;
    rulesByOrg.clear();
    alertInstanceTransitionState.clear();
    clearOpenAlertSet();
    orgEvalQueued.clear();
    orgEvalRerunPending.clear();
    started = false;
    logger.info('AlertEngine stopped');
}
