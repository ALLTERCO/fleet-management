import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import type {LoadedAlertRule} from '../alert/types';
import {
    buildDeliveryGroupingLabels,
    buildGroupKey,
    buildGroupKeyWithLabels
} from '../delivery/grouping';
import * as OutboxWorker from '../delivery/OutboxWorker';
import {describeError} from '../errorDescription';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {type AlertPayloadRow, buildAlertPayload} from './AlertPayloadBuilder';
import {
    readContactPointIds,
    readPositiveInteger,
    readPositiveIntegerArray
} from './contactPoints';
import {evaluateInhibition} from './NotificationInhibition';
import {
    type InhibitionSourceAlert,
    listActiveInhibitionSourceAlerts
} from './NotificationInhibitionSourceStore';
import {evaluateRoutingPolicies} from './RoutingPolicyEvaluator';
import {
    listRoutingPolicies,
    type StoredRoutingPolicy
} from './RoutingPolicyStore';
import {activeRoutingMatches} from './RoutingPolicySuppression';
import {readObject, readString, readStringArray} from './rowReaders';

const logger = log4js.getLogger('NotificationRouter');

export interface DeliveryJobReference {
    id: number;
    endpoint_id: number;
    provider: string;
}

export type RoutableAlertInstance = AlertPayloadRow & {
    state: string;
    /** ISO timestamp when an active silence expires, or null. */
    silenced_until?: string | null;
};

// Same comparator as notificationInboxModel.hasActiveSilence — kept in
// sync so delivery and inbox-derive agree on "is this silence active now".
function isInstanceSilenced(
    instance: RoutableAlertInstance,
    nowMs: number
): boolean {
    const until = instance.silenced_until;
    if (!until) return false;
    const ts = new Date(until).getTime();
    return Number.isFinite(ts) && ts > nowMs;
}

interface DeliveryGroupRow {
    group_id: number;
    is_new_group: boolean;
    is_first_flush: boolean;
    member_count: number;
    last_notified_at: string | null;
}

interface RouterDependencies {
    callMethod: typeof PostgresProvider.callMethod;
    enqueueGroupFlush: typeof OutboxWorker.enqueueGroupFlush;
    abortPendingJob: typeof OutboxWorker.abortPendingJob;
    enqueueEscalationStage: typeof OutboxWorker.enqueueEscalationStage;
    incrementCounter: typeof Observability.incrementCounter;
    listRoutingPolicies: typeof listRoutingPolicies;
    listActiveInhibitionSourceAlerts: typeof listActiveInhibitionSourceAlerts;
    now: () => number;
}

const defaultDependencies: RouterDependencies = {
    callMethod: PostgresProvider.callMethod,
    enqueueGroupFlush: OutboxWorker.enqueueGroupFlush,
    abortPendingJob: OutboxWorker.abortPendingJob,
    enqueueEscalationStage: OutboxWorker.enqueueEscalationStage,
    incrementCounter: Observability.incrementCounter,
    listRoutingPolicies,
    listActiveInhibitionSourceAlerts,
    now: Date.now
};

export async function routeAlertNotification(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    dependencies: RouterDependencies = defaultDependencies
): Promise<void> {
    if (isInstanceSilenced(input.instance, dependencies.now())) {
        dependencies.incrementCounter(
            'alert_delivery_suppressed_by_silence',
            1
        );
        return;
    }
    const target = await resolveDeliveryTarget(input, dependencies);
    if (!target) return;
    const jobs = await createDeliveryJobs(input, target, dependencies);
    if (jobs.length === 0) {
        // Targeted, but every endpoint resolved away (all disabled / empty
        // groups). Make the dropped delivery observable, not silent.
        dependencies.incrementCounter('alert_delivery_no_active_endpoints', 1);
        logger.debug(
            'no active endpoints for rule=%s alert=%s — nothing delivered',
            input.rule.id,
            input.instance.id
        );
        return;
    }
    try {
        await dispatchAlertToGroup(input, target, jobs, dependencies);
    } catch (err) {
        await abortJobsAfterDispatchFailure(input, jobs, err, dependencies);
        return;
    }
    await scheduleEscalationStages(input, target, dependencies);
}

export async function routeEscalationStageNotification(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
        stage: unknown;
    },
    dependencies: RouterDependencies = defaultDependencies
): Promise<void> {
    // Only an active alert escalates; ack/resolve/clear halt further rings.
    if (input.instance.state !== 'active') return;
    if (isInstanceSilenced(input.instance, dependencies.now())) {
        dependencies.incrementCounter(
            'alert_escalation_suppressed_by_silence',
            1
        );
        return;
    }
    const target = targetFromEscalationStage(input.stage);
    if (!target) return;
    const jobs = await createDeliveryJobs(input, target, dependencies);
    if (jobs.length === 0) {
        dependencies.incrementCounter(
            'alert_escalation_no_active_endpoints',
            1
        );
        logger.debug(
            'no active endpoints for escalation rule=%s alert=%s',
            input.rule.id,
            input.instance.id
        );
        return;
    }
    await dispatchAlertToGroup(input, target, jobs, dependencies);
}

type DeliveryTarget =
    | {
          kind: 'routing_policy';
          destinationGroupIds: number[];
          channelIds: number[];
          groupingKeys: string[];
          escalationStages: unknown[];
      }
    | {kind: 'rule_destination_groups'};

async function resolveDeliveryTarget(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    dependencies: RouterDependencies
): Promise<DeliveryTarget | null> {
    const policies = await dependencies.listRoutingPolicies({
        organizationId: input.rule.organizationId,
        enabledOnly: true
    });
    if (policies.length > 0) {
        return await resolveRoutingPolicyTarget(
            input,
            policies,
            new Date(dependencies.now()),
            dependencies
        );
    }
    if (
        input.rule.destinationGroupIds.length === 0 &&
        input.rule.destinationChannelIds.length === 0
    ) {
        return null;
    }
    return {kind: 'rule_destination_groups'};
}

async function resolveRoutingPolicyTarget(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    policies: StoredRoutingPolicy[],
    at: Date,
    dependencies: RouterDependencies
): Promise<DeliveryTarget | null> {
    const payload = buildAlertPayload(input.rule, input.instance);
    const labels = buildRoutingLabels(input.rule, input.instance);
    const matches = evaluateRoutingPolicies({
        policies,
        severity: input.instance.severity,
        labels,
        resource: payload.source
            ? {
                  type: payload.source.subjectType,
                  id: payload.source.subjectId
              }
            : undefined
    });
    const activeMatches = activeRoutingMatches({matches, at});
    if (
        await targetIsInhibited({
            rule: input.rule,
            instance: input.instance,
            matches: activeMatches,
            labels,
            dependencies
        })
    ) {
        dependencies.incrementCounter('notification_inhibition_suppressed');
        return null;
    }
    const contactPoints = activeMatches.flatMap((match) => match.contactPoints);
    const destinationGroupIds = uniqueNumbers(
        readContactPointIds(contactPoints, 'destination_group')
    );
    const channelIds = uniqueNumbers(
        readContactPointIds(contactPoints, 'channel')
    );
    if (destinationGroupIds.length === 0 && channelIds.length === 0)
        return null;
    return {
        kind: 'routing_policy',
        destinationGroupIds,
        channelIds,
        groupingKeys: firstNonEmptyGroupingKeys(activeMatches),
        escalationStages: activeMatches.flatMap(
            (match) => match.escalationStages
        )
    };
}

async function targetIsInhibited(input: {
    rule: LoadedAlertRule;
    instance: RoutableAlertInstance;
    matches: Array<{inhibitionRules: unknown[]}>;
    labels: Record<string, string>;
    dependencies: RouterDependencies;
}): Promise<boolean> {
    const rules = input.matches.flatMap((match) => match.inhibitionRules);
    if (rules.length === 0) return false;
    const sources = await input.dependencies.listActiveInhibitionSourceAlerts({
        organizationId: input.rule.organizationId
    });
    const target = {
        id: input.instance.id,
        state: input.instance.state as 'active' | 'acknowledged' | 'resolved',
        severity: input.instance.severity,
        labels: input.labels
    };
    const decision = evaluateInhibition({
        target,
        sources: sources.map(sourceToFact),
        rules
    });
    return decision.inhibited;
}

function sourceToFact(source: InhibitionSourceAlert) {
    const payload = buildAlertPayload(source.rule, source.alert);
    return {
        id: source.alert.id,
        state: source.alert.state as 'active' | 'acknowledged' | 'resolved',
        severity: source.alert.severity,
        labels: buildDeliveryGroupingLabels(source.rule, payload)
    };
}

async function createDeliveryJobs(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    target: DeliveryTarget,
    dependencies: RouterDependencies
): Promise<DeliveryJobReference[]> {
    if (target.kind === 'routing_policy') {
        return createRoutedDeliveryJobs(input, target, dependencies);
    }
    const result = await dependencies.callMethod(
        'notifications.fn_delivery_job_create_batch',
        {
            p_organization_id: input.rule.organizationId,
            p_rule_id: input.rule.id,
            p_alert_id: input.instance.id,
            p_inbox_item_id: null,
            p_destination_channel_ids: input.rule.destinationChannelIds
        }
    );
    return (result?.rows ?? []) as DeliveryJobReference[];
}

async function createRoutedDeliveryJobs(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    target: Extract<DeliveryTarget, {kind: 'routing_policy'}>,
    dependencies: RouterDependencies
): Promise<DeliveryJobReference[]> {
    const result = await dependencies.callMethod(
        'notifications.fn_delivery_job_create_for_contact_points',
        {
            p_organization_id: input.rule.organizationId,
            p_destination_group_ids: target.destinationGroupIds,
            p_channel_ids: target.channelIds,
            p_alert_id: input.instance.id,
            p_inbox_item_id: null
        }
    );
    return (result?.rows ?? []) as DeliveryJobReference[];
}

function buildRoutingLabels(
    rule: LoadedAlertRule,
    instance: RoutableAlertInstance
): Record<string, string> {
    return buildDeliveryGroupingLabels(rule, buildAlertPayload(rule, instance));
}

function uniqueNumbers(values: number[]): number[] {
    return [...new Set(values)];
}

function firstNonEmptyGroupingKeys(
    matches: Array<{groupingKeys: string[]}>
): string[] {
    return (
        matches.find((match) => match.groupingKeys.length > 0)?.groupingKeys ??
        []
    );
}

async function scheduleEscalationStages(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    target: DeliveryTarget,
    dependencies: RouterDependencies
): Promise<void> {
    if (target.kind !== 'routing_policy') return;
    if (!['active', 'acknowledged'].includes(input.instance.state)) return;
    const stages = target.escalationStages
        .map((raw, index) => readScheduledEscalationStage(raw, index))
        .filter((stage): stage is ScheduledEscalationStage => stage !== null);
    for (const stage of stages) {
        await dependencies.enqueueEscalationStage(
            {
                organizationId: input.rule.organizationId,
                alertId: input.instance.id,
                ruleId: input.rule.id,
                stageId: stage.stageId,
                stage: stage.raw
            },
            new Date(dependencies.now() + stage.delaySec * 1000)
        );
    }
}

interface ScheduledEscalationStage {
    stageId: string;
    delaySec: number;
    raw: unknown;
}

function readScheduledEscalationStage(
    stage: unknown,
    index: number
): ScheduledEscalationStage | null {
    const record = readObject(stage);
    const delaySec = readStageDelaySec(record);
    if (delaySec <= 0) return null;
    if (!targetFromEscalationStage(stage)) return null;
    // Append the array index so two stages that share an id/name — or none,
    // falling back to the delay — get distinct job keys instead of one
    // collapsing onto the other under jobKeyMode 'preserve_run_at'.
    const base = readString(record.id ?? record.name) ?? 'stage';
    return {
        stageId: `${base}#${index}`,
        delaySec,
        raw: stage
    };
}

function readStageDelaySec(record: Record<string, unknown>): number {
    return (
        readPositiveInteger(record.delaySec) ??
        readPositiveInteger(record.delaySeconds) ??
        minutesToSeconds(readPositiveInteger(record.delayMinutes)) ??
        0
    );
}

function minutesToSeconds(minutes: number | null): number | null {
    return minutes == null ? null : minutes * 60;
}

function targetFromEscalationStage(
    stage: unknown
): Extract<DeliveryTarget, {kind: 'routing_policy'}> | null {
    const record = readObject(stage);
    const destinationGroupIds = uniqueNumbers([
        ...readPositiveIntegerArray(record.destinationGroupIds),
        ...readContactPointIds(readContactPoints(record), 'destination_group')
    ]);
    const channelIds = uniqueNumbers([
        ...readPositiveIntegerArray(record.channelIds),
        ...readContactPointIds(readContactPoints(record), 'channel')
    ]);
    if (destinationGroupIds.length === 0 && channelIds.length === 0) {
        return null;
    }
    return {
        kind: 'routing_policy',
        destinationGroupIds,
        channelIds,
        groupingKeys: readStringArray(record.groupingKeys),
        escalationStages: []
    };
}

function readContactPoints(record: Record<string, unknown>): unknown[] {
    return Array.isArray(record.contactPoints) ? record.contactPoints : [];
}

async function dispatchAlertToGroup(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    target: DeliveryTarget,
    jobs: DeliveryJobReference[],
    dependencies: RouterDependencies
): Promise<void> {
    const row = await upsertGroupAndAddMembers(
        input,
        target,
        jobs.map((job) => job.endpoint_id),
        dependencies
    );
    if (!row) return;
    await scheduleGroupFlush(row, dependencies);
    if (input.instance.state === 'resolved') {
        await flushOnGroupResolution(row.group_id, dependencies);
    }
}

async function upsertGroupAndAddMembers(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    target: DeliveryTarget,
    endpointIds: number[],
    dependencies: RouterDependencies
): Promise<DeliveryGroupRow | undefined> {
    const payload = buildAlertPayload(input.rule, input.instance);
    const groupKey =
        target.kind === 'routing_policy' && target.groupingKeys.length > 0
            ? buildGroupKeyWithLabels({
                  rule: input.rule,
                  payload,
                  labels: target.groupingKeys
              })
            : buildGroupKey(input.rule, payload);
    const upserted = await dependencies.callMethod(
        'notifications.fn_delivery_group_upsert_and_add_members',
        {
            p_organization_id: input.rule.organizationId,
            p_rule_id: input.rule.id,
            p_group_key_hash: groupKey.hash,
            p_group_key: groupKey.values,
            p_alert_id: input.instance.id,
            p_endpoint_ids: endpointIds
        }
    );
    return upserted?.rows?.[0] as DeliveryGroupRow | undefined;
}

async function scheduleGroupFlush(
    row: DeliveryGroupRow,
    dependencies: RouterDependencies
): Promise<void> {
    const flushAt = computeFlushRunAt(row, dependencies.now());
    if (!flushAt) return;
    await dependencies.enqueueGroupFlush(
        row.group_id,
        flushAt,
        row.member_count >= tuning.alert.groupMaxMembers
    );
}

function computeFlushRunAt(
    row: {
        is_first_flush: boolean;
        member_count: number;
        last_notified_at: string | null;
    },
    nowMs: number
): Date | null {
    if (row.member_count >= tuning.alert.groupMaxMembers)
        return new Date(nowMs);
    if (row.is_first_flush) {
        return new Date(nowMs + tuning.alert.groupWaitSec * 1000);
    }
    const lastMs = row.last_notified_at ? Date.parse(row.last_notified_at) : 0;
    const earliest = lastMs + tuning.alert.groupIntervalSec * 1000;
    return new Date(Math.max(earliest, nowMs));
}

async function flushOnGroupResolution(
    groupId: number,
    dependencies: RouterDependencies
): Promise<void> {
    const resolved = await dependencies.callMethod(
        'notifications.fn_delivery_group_resolve_if_all_resolved',
        {p_group_id: groupId}
    );
    const row = resolved?.rows?.[0] as {just_resolved: boolean} | undefined;
    if (row?.just_resolved) {
        await dependencies.enqueueGroupFlush(groupId, new Date(), true);
    }
}

async function abortJobsAfterDispatchFailure(
    input: {
        rule: LoadedAlertRule;
        instance: RoutableAlertInstance;
    },
    jobs: DeliveryJobReference[],
    cause: unknown,
    dependencies: RouterDependencies
): Promise<void> {
    const reason = `alert dispatch failed: ${describeError(cause)}`;
    logger.error(
        'alert-group dispatch for alert %d failed — aborting %d job(s): %s',
        input.instance.id,
        jobs.length,
        reason
    );
    dependencies.incrementCounter('alert_dispatch_failures');
    for (const job of jobs) {
        await abortDeliveryJobSafely(
            {
                organizationId: input.rule.organizationId,
                job,
                reason,
                abortFailureMetricName: 'alert_dispatch_abort_failures'
            },
            dependencies
        );
    }
}

export async function abortDeliveryJobSafely(
    input: {
        organizationId: string;
        job: DeliveryJobReference;
        reason: string;
        abortFailureMetricName: string;
    },
    dependencies: RouterDependencies = defaultDependencies
): Promise<void> {
    try {
        await dependencies.abortPendingJob({
            jobId: input.job.id,
            organizationId: input.organizationId,
            endpointId: input.job.endpoint_id,
            reason: input.reason
        });
    } catch (err) {
        dependencies.incrementCounter(input.abortFailureMetricName);
        logger.error(
            'failed to abort delivery_job %d: %s',
            input.job.id,
            String(err)
        );
    }
}
