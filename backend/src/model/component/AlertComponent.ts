import {
    invalidateRecipientsCache as invalidateAlertRecipientsCache,
    invalidateRuleCache as invalidateAlertRuleCache,
    noteOperatorAlertChange,
    scheduleInitialRuleEvaluation
} from '../../modules/AlertEngine';
import * as AlertEvents from '../../modules/AlertEvents';
import {
    type AlertActiveWindow,
    readActiveWindow
} from '../../modules/alert/activeWindow';
import {
    bluetoothCapabilityView,
    capabilityViewOf,
    type DeviceCapabilityView,
    deviceSupportsKind
} from '../../modules/alert/deviceCapability';
import {clearAnomalyBandCacheForRule} from '../../modules/alert/evaluators/anomalyBand';
import {clearChangeEventCacheForRule} from '../../modules/alert/evaluators/changeEvent';
import {
    alertSubjectMissing,
    hydratePublicAlertSubjects,
    resolveDurableAlertSubjectId
} from '../../modules/alert/logicalDeviceFingerprint';
import {
    collectBluetoothComponentPaths,
    collectBluetoothMetrics,
    collectComponentPaths,
    collectMetrics,
    scanStatusMetrics,
    scanStatusStates
} from '../../modules/alert/metricCatalog';
import {previewRuleAgainstOrg} from '../../modules/alert/rulePreview';
import {rowToLoadedRule} from '../../modules/alert/ruleRow';
import {
    hydratePublicRuleScopes,
    replaceRuleSubjectScope
} from '../../modules/alert/ruleScopePersistence';
import type {LoadedAlertRule} from '../../modules/alert/types';
import {
    assertRuleHasRecipient,
    normalizeAlertRuleConfig,
    normalizeDestinationChannelIds,
    normalizeDestinationGroupIds,
    normalizeGroupBy,
    normalizeOptionalText,
    normalizeOptionalUserId,
    publicScopeSelector,
    resolveAlertRuleAutoResolve,
    storageScopeSelector,
    validateSupportedScopeSelector
} from '../../modules/alertRuleModel';
import {
    type AlertInstanceAuditOperation,
    authzAuditActor,
    authzAuditWriter
} from '../../modules/authz/audit/AuthzAuditWriter';
import {
    canCrossOrganizationBoundary,
    canPerformComponentOperationAsync,
    hasTenantWideComponentPermission,
    isComponentPermissionAllowed,
    requireTenantWideComponentPermission
} from '../../modules/authz/evaluator';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as OutboxWorker from '../../modules/delivery/OutboxWorker';
import * as postgres from '../../modules/PostgresProvider';
import {withPostgresTransaction} from '../../modules/postgresTx';
import {
    getBluetoothDevice,
    listBluetoothDevices
} from '../../modules/virtualDevice/bluetoothRepository';
import {
    bluetoothDeviceSnapshot,
    createDeviceCollectorSnapshotFetcher
} from '../../modules/virtualDevice/deviceListIntegration';
import {
    assignVirtualComponentIds,
    virtualEntityId,
    virtualEntityType
} from '../../modules/virtualDevice/entityProjection';
import {
    listVirtualEntities,
    type VirtualEntityResolution
} from '../../modules/virtualDevice/virtualEntityResolver';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {asOperationFailed} from '../../rpc/operationError';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ALERT_ANNOTATION_APPEND_PARAMS_SCHEMA,
    ALERT_ANNOTATION_DELETE_PARAMS_SCHEMA,
    ALERT_ANNOTATION_EDIT_PARAMS_SCHEMA,
    ALERT_ANNOTATION_LIST_PARAMS_SCHEMA,
    ALERT_DESCRIBE,
    ALERT_INSTANCE_ACK_PARAMS_SCHEMA,
    ALERT_INSTANCE_GET_MANY_PARAMS_SCHEMA,
    ALERT_INSTANCE_GET_PARAMS_SCHEMA,
    ALERT_INSTANCE_LIST_PARAMS_SCHEMA,
    ALERT_INSTANCE_LIST_TRANSITIONS_PARAMS_SCHEMA,
    ALERT_INSTANCE_RESOLVE_MANUAL_PARAMS_SCHEMA,
    ALERT_INSTANCE_SILENCE_PARAMS_SCHEMA,
    ALERT_INSTANCE_UNACK_PARAMS_SCHEMA,
    ALERT_INSTANCE_UNSILENCE_PARAMS_SCHEMA,
    ALERT_KIND_TO_FAMILY,
    ALERT_RULE_CHECK_DUPLICATE_PARAMS_SCHEMA,
    ALERT_RULE_CREATE_FROM_TEMPLATE_PARAMS_SCHEMA,
    ALERT_RULE_CREATE_PARAMS_SCHEMA,
    ALERT_RULE_DELETE_PARAMS_SCHEMA,
    ALERT_RULE_GET_PARAMS_SCHEMA,
    ALERT_RULE_KIND_DESCRIPTOR_BY_KEY,
    ALERT_RULE_KIND_DESCRIPTORS,
    ALERT_RULE_LIST_COMPONENT_PATHS_PARAMS_SCHEMA,
    ALERT_RULE_LIST_ELIGIBLE_DEVICES_PARAMS_SCHEMA,
    ALERT_RULE_LIST_FIRINGS_PARAMS_SCHEMA,
    ALERT_RULE_LIST_KINDS_PARAMS_SCHEMA,
    ALERT_RULE_LIST_METRIC_PATHS_PARAMS_SCHEMA,
    ALERT_RULE_LIST_PARAMS_SCHEMA,
    ALERT_RULE_LIST_TEMPLATES_PARAMS_SCHEMA,
    ALERT_RULE_PREVIEW_PARAMS_SCHEMA,
    ALERT_RULE_TEMPLATE_CREATE_PARAMS_SCHEMA,
    ALERT_RULE_TEMPLATE_DELETE_PARAMS_SCHEMA,
    ALERT_RULE_TEMPLATE_UPDATE_PARAMS_SCHEMA,
    ALERT_RULE_UPDATE_PARAMS_SCHEMA,
    type AlertAnnotation,
    type AlertInstance,
    type AlertInstanceGetManyResult,
    type AlertInstanceListFilters,
    type AlertInstanceListPage,
    type AlertRule,
    type AlertRuleFiring,
    type AlertRuleKind,
    type AlertRuleTemplate,
    type AlertSeverity,
    type AlertState,
    type AlertTransition,
    type AlertTransitionAction,
    MANUAL_RESOLVE_REFUSAL,
    publicAlertRuleKind,
    publicAlertSourceType,
    type ScopeSelector,
    type StoredAlertRuleKind,
    type StoredAlertSourceType,
    storedAlertRuleKind,
    storedAlertSourceType
} from '../../types/api/alert';
import type {BluetoothDeviceDto} from '../../types/api/virtualdevice';
import type CommandSender from '../CommandSender';
import {type AccessibleReach, intersectReach} from '../CommandSender';
import {
    type AlertListPosition,
    alertListFilterMark,
    decodeAlertListCursor,
    encodeAlertListCursor
} from './alertListCursor';
import Component from './Component';

type JsonRecord = Record<string, unknown>;
type AlertRuleOperation = 'create' | 'update' | 'delete';

function bluetoothGatewaySnapshot(device: BluetoothDeviceDto) {
    const externalId = device.primaryTransport?.shellyDeviceExternalId;
    if (!externalId) return null;
    return createDeviceCollectorSnapshotFetcher(DeviceCollector)(externalId);
}

interface AlertRuleRow {
    id: number;
    organization_id: string;
    name: string;
    kind: StoredAlertRuleKind;
    enabled: boolean;
    severity: AlertSeverity;
    scope: JsonRecord | null;
    dedupe_window_sec: number;
    cooldown_sec: number;
    destination_group_ids: unknown;
    destination_channel_ids: unknown;
    owner_user_id: string | null;
    summary_template: string | null;
    message_template: string | null;
    auto_resolve: boolean;
    trigger_once: boolean;
    config: JsonRecord | null;
    group_by: string[] | null;
    delivery_mode: string | null;
    digest_window_minutes: number | null;
    runbook_url: string | null;
    template_id: number | null;
    active_window: unknown;
    last_fired_at: Date | string | null;
    condition_family: string | null;
    condition_subkind: string | null;
    labels_template: Record<string, unknown> | null;
    created_at: Date | string;
    updated_at: Date | string | null;
}

type AlertRuleListRow = Partial<AlertRuleRow> & {
    total_count?: number | string;
};

interface AlertInstanceRow {
    id: number;
    organization_id: string;
    rule_id: number;
    rule_kind: StoredAlertRuleKind;
    state: AlertState;
    severity: AlertSeverity;
    source_subject_type: StoredAlertSourceType;
    source_subject_id: string;
    source_location_id: number | null;
    title: string;
    message: string;
    fingerprint: string;
    active_since: Date | string;
    last_triggered_at: Date | string;
    acknowledged_at: Date | string | null;
    acknowledged_by_user_id: string | null;
    acknowledged_by_display_name: string | null;
    ack_comment: string | null;
    resolved_at: Date | string | null;
    resolved_by_user_id: string | null;
    resolved_by_display_name: string | null;
    silenced_until: Date | string | null;
    silence_reason: string | null;
    silenced_by_user_id: string | null;
    silenced_by_display_name: string | null;
    notifications_created_count: number | string;
    delivery_jobs_created_count: number | string;
    context: JsonRecord | null;
}

type AlertInstanceListRow = Partial<AlertInstanceRow> & {
    total_count?: number | string;
    cursor_triggered_at?: string | null;
};

interface AlertTransitionRow {
    created_at: Date | string;
    action: AlertTransitionAction;
    actor_user_id: string | null;
    actor_display_name: string | null;
    data: JsonRecord | null;
}

type AlertTransitionListRow = Partial<AlertTransitionRow> & {
    total_count?: number | string;
};

interface AlertRuleFiringRow {
    transition_id: number;
    alert_id: number;
    action: 'created' | 'triggered';
    fired_at: Date | string;
    source_subject_type: StoredAlertSourceType;
    source_subject_id: string;
    severity: AlertSeverity;
    title: string;
}

type AlertRuleFiringListRow = Partial<AlertRuleFiringRow> & {
    total_count?: number | string;
};

interface AlertRuleTemplateRow {
    id: number;
    organization_id: string | null;
    template_key: string;
    category: string;
    label: string;
    description: string | null;
    kind: StoredAlertRuleKind | null;
    severity: AlertSeverity;
    scope: JsonRecord | null;
    config: JsonRecord | null;
    dedupe_window_sec: number;
    cooldown_sec: number;
    summary_template: string | null;
    message_template: string | null;
    auto_resolve: boolean;
    active_window: unknown;
    available: boolean;
    unavailable_reason: string | null;
    author_user_id: string | null;
}

interface RuleCreateSpec {
    name: string;
    kind: AlertRuleKind;
    severity: AlertSeverity;
    enabled: boolean;
    scope: ScopeSelector;
    dedupeWindowSec: number;
    cooldownSec: number;
    destinationGroupIds: number[];
    destinationChannelIds: number[];
    ownerUserId: string | null;
    summaryTemplate: string | null;
    messageTemplate: string | null;
    autoResolve: boolean;
    triggerOnce: boolean;
    config: JsonRecord;
    groupBy: string[] | null;
    deliveryMode: 'instant' | 'digest';
    digestWindowMinutes: number | null;
    activeWindow: AlertActiveWindow | null;
    runbookUrl: string | null;
    templateId: number | null;
}

function cloneRecord(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return structuredClone(value) as JsonRecord;
}

function normalizeName(name: string, label: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw RpcError.InvalidParams(`${label} cannot be empty`);
    return trimmed;
}

interface TemplateAvailabilityInput {
    available: boolean;
    unavailableReason: string | null;
}

interface TemplateAvailabilityPatch {
    available: boolean | null;
    unavailableReason: string | null;
    clearUnavailableReason: boolean;
}

function normalizeTemplateAvailability(
    input: TemplateAvailabilityInput
): TemplateAvailabilityInput {
    const unavailableReason = normalizeOptionalText(input.unavailableReason);
    if (input.available && unavailableReason !== null) {
        throw RpcError.InvalidParams(
            'An available alert template cannot have an unavailable reason.'
        );
    }
    if (!input.available && unavailableReason === null) {
        throw RpcError.InvalidParams(
            'An unavailable alert template requires a reason.'
        );
    }
    return {available: input.available, unavailableReason};
}

function normalizeTemplateAvailabilityPatch(input: {
    available?: boolean;
    unavailableReason?: string | null;
}): TemplateAvailabilityPatch {
    if (
        input.available === undefined &&
        input.unavailableReason === undefined
    ) {
        return {
            available: null,
            unavailableReason: null,
            clearUnavailableReason: false
        };
    }
    if (
        input.available === undefined ||
        input.unavailableReason === undefined
    ) {
        throw RpcError.InvalidParams(
            'available and unavailableReason must be updated together.'
        );
    }
    const normalized = normalizeTemplateAvailability({
        available: input.available,
        unavailableReason: input.unavailableReason
    });
    return {
        ...normalized,
        clearUnavailableReason: normalized.unavailableReason === null
    };
}

// A rule reaches recipients two ways — destination groups and directly-picked
// channels. Each maps to its own replace SQL; everything else is identical.
type RuleDestinationKind = 'groups' | 'channels';
const RULE_DESTINATION_REPLACERS: Record<
    RuleDestinationKind,
    {fn: string; param: string}
> = {
    groups: {
        fn: 'notifications.fn_alert_rule_replace_destination_groups',
        param: 'p_destination_group_ids'
    },
    channels: {
        fn: 'notifications.fn_alert_rule_replace_destination_channels',
        param: 'p_destination_channel_ids'
    }
};

function toIntArray(value: unknown): number[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) =>
                typeof entry === 'number' ? entry : Number(String(entry))
            )
            .filter(
                (entry): entry is number =>
                    Number.isInteger(entry) && Number.isFinite(entry)
            )
            .sort((left, right) => left - right);
    }

    if (typeof value === 'string') {
        const normalized = value.trim().replace(/^\{|\}$/g, '');
        if (!normalized) return [];
        return normalized
            .split(',')
            .map((entry) => Number(entry.trim()))
            .filter(
                (entry): entry is number =>
                    Number.isInteger(entry) && Number.isFinite(entry)
            )
            .sort((left, right) => left - right);
    }

    return [];
}

// A tenant-wide alert grant is not narrowed by what the caller reaches.
async function alertReach(
    sender: CommandSender
): Promise<AccessibleReach | null> {
    if (await hasTenantWideComponentPermission(sender, 'alerts', 'read')) {
        return null;
    }
    return sender.accessibleReach();
}

interface AlertInstanceListParams extends AlertInstanceListFilters {
    organizationId?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
}

interface AlertListPageRequest {
    limit: number;
    offset: number;
    after: AlertListPosition | null;
    /** A cursor page reads one extra row to learn has_more without a count. */
    fetchLimit: number;
    /** Next cursors carry it; a cursor with another mark is refused. */
    filterMark: string;
}

function alertListPageRequest(
    p: AlertInstanceListParams,
    filterMark: string
): AlertListPageRequest {
    const limit = p.limit ?? 200;
    if (p.cursor === undefined) {
        return {
            limit,
            offset: p.offset ?? 0,
            after: null,
            fetchLimit: limit,
            filterMark
        };
    }
    // The schema fills offset 0; only a real offset conflicts with a cursor.
    if ((p.offset ?? 0) > 0) {
        throw RpcError.InvalidParams('send cursor or offset, not both', [
            {
                field: 'offset',
                error: 'not allowed with cursor',
                code: 'conflict'
            }
        ]);
    }
    return {
        limit,
        offset: 0,
        after: decodeAlertListCursor(p.cursor, filterMark),
        fetchLimit: limit + 1,
        filterMark
    };
}

function listParamError(field: string, error: string, code: string): RpcError {
    return RpcError.InvalidParams(`${field} is not valid`, [
        {field, error, code}
    ]);
}

// `state` is the one-item form of `states`; both mean the same filter.
function alertListStates(p: AlertInstanceListFilters): AlertState[] | null {
    if (p.state !== undefined && p.states !== undefined) {
        throw listParamError('states', 'not with state', 'conflict');
    }
    if (p.states !== undefined) {
        if (new Set(p.states).size !== p.states.length) {
            throw listParamError('states', 'repeats a state', 'unique');
        }
        return [...p.states].sort();
    }
    return p.state !== undefined ? [p.state] : null;
}

async function alertListFilterParams(
    organizationId: string,
    p: AlertInstanceListParams
): Promise<Record<string, unknown>> {
    const states = alertListStates(p);
    const sourceId =
        (p.sourceType === 'device' || p.sourceType === 'component') &&
        p.sourceId?.trim()
            ? await resolveDurableAlertSubjectId(
                  organizationId,
                  p.sourceType === 'component' ? 'entity' : 'device',
                  p.sourceId.trim()
              )
            : p.sourceId?.trim() || null;
    return {
        p_organization_id: organizationId,
        p_states: states,
        p_acknowledged: p.acknowledged ?? null,
        p_silenced: p.silenced ?? null,
        p_severity: p.severity ?? null,
        p_rule_id: p.ruleId ?? null,
        p_source_type: p.sourceType
            ? storedAlertSourceType(p.sourceType)
            : null,
        p_source_id: sourceId,
        p_location_ids: normalizeIntIds(p.locationIds),
        p_group_ids: normalizeIntIds(p.groupIds),
        p_tag_ids: normalizeIntIds(p.tagIds),
        p_query: p.query?.trim() || null,
        p_open: p.open ?? null
    };
}

function alertListPage(
    rows: AlertInstanceListRow[],
    page: AlertListPageRequest
): AlertInstanceListPage {
    const listed = rows.filter((row) => row.id != null);
    const shown = listed.slice(0, page.limit);
    const hasMore =
        page.after === null
            ? page.offset + shown.length < Number(rows[0]?.total_count ?? 0)
            : listed.length > page.limit;
    const last = shown[shown.length - 1];
    const nextCursor =
        hasMore && last?.cursor_triggered_at && last.id != null
            ? encodeAlertListCursor(
                  {triggeredAt: last.cursor_triggered_at, id: last.id},
                  page.filterMark
              )
            : null;
    const items = shown.map((row) =>
        rowToAlertInstance(row as AlertInstanceRow)
    );
    if (page.after !== null) {
        return {
            items,
            limit: page.limit,
            has_more: hasMore,
            next_cursor: nextCursor
        };
    }
    return {
        ...buildListResponse(
            items,
            Number(rows[0]?.total_count ?? 0),
            page.limit,
            page.offset
        ),
        next_cursor: nextCursor
    };
}

// The `alert` authz resource is the rule. An alert, template or device id is
// not a rule id, so these methods check the grant alone and decide reach themselves.
const NOT_A_RULE_ID = (): undefined => undefined;

// A template belongs to the whole tenant, so only a tenant-wide grant writes it.
async function requireOrgWideAlertGrant(
    sender: CommandSender,
    operation: 'update' | 'delete'
): Promise<void> {
    await requireTenantWideComponentPermission(sender, 'alerts', operation);
}

// A write reaches what the write grants reach and the caller can also read,
// so an update grant never acts on an alert its holder cannot list.
async function alertWriteReach(
    sender: CommandSender
): Promise<AccessibleReach | null> {
    return intersectReach(
        await alertReach(sender),
        await sender.reachForOperation('alerts', 'update')
    );
}

// Null reach leaves the list unfiltered; SQL narrows before it slices.
function reachParams(reach: AccessibleReach | null): {
    p_reach_device_ids: string[] | null;
    p_reach_location_ids: number[] | null;
    p_reach_group_ids: number[] | null;
} {
    if (!reach) {
        return {
            p_reach_device_ids: null,
            p_reach_location_ids: null,
            p_reach_group_ids: null
        };
    }
    return {
        p_reach_device_ids: [...reach.deviceIds],
        p_reach_location_ids: [...reach.locationIds],
        p_reach_group_ids: [...reach.groupIds]
    };
}

// Another surface showing one alert's content (a template preview) asks
// the same question Instance.Get does: may this caller read this alert?
export async function requireAlertReadable(
    sender: CommandSender,
    organizationId: string,
    id: number
): Promise<void> {
    const decision = await canPerformComponentOperationAsync(
        sender,
        'alerts',
        'read'
    );
    if (!isComponentPermissionAllowed(decision)) {
        throw RpcError.PermissionDenied(sender.isAuthenticated());
    }
    const reach = await alertReach(sender);
    if (reach === null) return;
    const result = await postgres.callMethod(
        'notifications.fn_alert_instance_get',
        {p_organization_id: organizationId, p_id: id, ...reachParams(reach)}
    );
    if (result?.rows?.[0]) return;
    throw RpcError.PermissionDenied(sender.isAuthenticated());
}

function rowToAlertRule(row: AlertRuleRow): AlertRule {
    return {
        activeWindow: readActiveWindow(row.active_window),
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        kind: publicAlertRuleKind(row.kind),
        enabled: row.enabled,
        severity: row.severity,
        scope: publicScopeSelector(row.scope),
        dedupeWindowSec: Number(row.dedupe_window_sec ?? 0),
        cooldownSec: Number(row.cooldown_sec ?? 0),
        destinationGroupIds: toIntArray(row.destination_group_ids),
        destinationChannelIds: toIntArray(row.destination_channel_ids),
        deliveryMode: row.delivery_mode === 'digest' ? 'digest' : 'instant',
        digestWindowMinutes:
            typeof row.digest_window_minutes === 'number' &&
            row.digest_window_minutes >= 1
                ? row.digest_window_minutes
                : null,
        ownerUserId: row.owner_user_id,
        summaryTemplate: row.summary_template,
        messageTemplate: row.message_template,
        autoResolve: row.auto_resolve,
        triggerOnce: row.trigger_once === true,
        config: cloneRecord(row.config),
        groupBy: Array.isArray(row.group_by)
            ? row.group_by.map((v) => String(v))
            : null,
        runbookUrl:
            typeof row.runbook_url === 'string' && row.runbook_url.length > 0
                ? row.runbook_url
                : null,
        templateId:
            typeof row.template_id === 'number' ? row.template_id : null,
        lastFiredAt: toIso(row.last_fired_at),
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}

function rowToAlertInstance(row: AlertInstanceRow): AlertInstance {
    return {
        id: row.id,
        organizationId: row.organization_id,
        ruleId: row.rule_id,
        ruleKind: publicAlertRuleKind(row.rule_kind),
        state: row.state,
        severity: row.severity,
        source: {
            organizationId: row.organization_id,
            subjectType: publicAlertSourceType(row.source_subject_type),
            subjectId: row.source_subject_id,
            locationId: row.source_location_id ?? null
        },
        title: row.title,
        message: row.message,
        fingerprint: row.fingerprint,
        activeSince: toIso(row.active_since) ?? '',
        lastTriggeredAt: toIso(row.last_triggered_at) ?? '',
        acknowledgedAt: toIso(row.acknowledged_at),
        acknowledgedBy: row.acknowledged_by_user_id
            ? {
                  userId: row.acknowledged_by_user_id,
                  displayName: row.acknowledged_by_display_name
              }
            : null,
        ackComment:
            typeof row.ack_comment === 'string' && row.ack_comment.length > 0
                ? row.ack_comment
                : null,
        resolvedAt: toIso(row.resolved_at),
        resolvedBy: row.resolved_by_user_id
            ? {
                  userId: row.resolved_by_user_id,
                  displayName: row.resolved_by_display_name
              }
            : null,
        silencedUntil: toIso(row.silenced_until),
        silenceReason: row.silence_reason,
        silencedBy: row.silenced_by_user_id
            ? {
                  userId: row.silenced_by_user_id,
                  displayName: row.silenced_by_display_name
              }
            : null,
        counts: {
            notificationsCreated: Number(row.notifications_created_count ?? 0),
            deliveryJobsCreated: Number(row.delivery_jobs_created_count ?? 0)
        },
        context: cloneRecord(row.context)
    };
}

function emitAlertInstanceEvent(
    method: 'Alert.Updated' | 'Alert.Resolved',
    row: AlertInstanceRow
): void {
    const params: AlertEvents.AlertWsParams = {
        organizationId: row.organization_id,
        alertId: row.id,
        ruleId: row.rule_id,
        ruleKind: publicAlertRuleKind(row.rule_kind),
        state: row.state,
        severity: row.severity
    };
    if (method === 'Alert.Resolved') {
        AlertEvents.emitAlertResolved(params);
    } else {
        AlertEvents.emitAlertUpdated(params);
    }
}

function rowToAlertRuleFiring(
    row: AlertRuleFiringRow,
    organizationId: string
): AlertRuleFiring {
    return {
        transitionId: row.transition_id,
        alertId: row.alert_id,
        action: row.action,
        firedAt: toIso(row.fired_at) ?? '',
        source: {
            organizationId,
            subjectType: publicAlertSourceType(row.source_subject_type),
            subjectId: row.source_subject_id
        },
        severity: row.severity,
        title: row.title
    };
}

function rowToAlertRuleTemplate(row: AlertRuleTemplateRow): AlertRuleTemplate {
    return {
        id: Number(row.id ?? 0),
        organizationId: row.organization_id,
        templateKey: row.template_key,
        category: row.category,
        label: row.label,
        description: row.description,
        kind: row.kind === null ? null : publicAlertRuleKind(row.kind),
        severity: row.severity,
        scope: publicScopeSelector(row.scope),
        config: cloneRecord(row.config),
        dedupeWindowSec: Number(row.dedupe_window_sec ?? 0),
        cooldownSec: Number(row.cooldown_sec ?? 0),
        summaryTemplate: row.summary_template,
        messageTemplate: row.message_template,
        autoResolve: row.auto_resolve,
        activeWindow: readActiveWindow(row.active_window),
        available: row.available,
        unavailableReason: row.unavailable_reason,
        authorUserId: row.author_user_id
    };
}

function rowToAlertTransition(row: AlertTransitionRow): AlertTransition {
    return {
        at: toIso(row.created_at) ?? '',
        action: row.action,
        actor: row.actor_user_id
            ? {
                  userId: row.actor_user_id,
                  displayName: row.actor_display_name
              }
            : null,
        data: cloneRecord(row.data)
    };
}

function normalizeIntIds(values?: number[]): number[] | null {
    if (!Array.isArray(values) || values.length === 0) return null;
    return [...new Set(values)]
        .filter(
            (value): value is number =>
                Number.isInteger(value) && Number.isFinite(value)
        )
        .sort((left, right) => left - right);
}

function requireActionActor(sender: CommandSender): {
    userId: string;
    displayName: string | null;
} {
    // Stable Zitadel sub — survives email/name changes, matches author-only
    // edit checks across token refreshes.
    const userId = sender.getUserId();
    if (!userId || userId === '<UNAUTHORIZED>') {
        throw RpcError.Unauthorized();
    }

    // Snapshot at write time; frozen against a later rename.
    return {userId, displayName: actorDisplayName(sender)};
}

// Real name from the token's `name` claim, falling back to email/username when
// absent (e.g. service tokens). Snapshotted so a later rename doesn't rewrite
// historical actor records.
function actorDisplayName(sender: CommandSender): string | null {
    const user = sender.getUser();
    return user?.displayName ?? user?.username ?? null;
}

function parseFutureTimestamp(value: string, label: string): string {
    const parsed = new Date(value);
    const ts = parsed.getTime();
    if (!Number.isFinite(ts)) {
        throw RpcError.InvalidParams(
            `${label} must be a valid ISO date string`
        );
    }
    if (ts <= Date.now()) {
        throw RpcError.InvalidParams(`${label} must be in the future`);
    }
    return parsed.toISOString();
}

function isResolvedAlert(row: AlertInstanceRow): boolean {
    return row.resolved_at != null || row.state === 'resolved';
}

function throwResolvedAlertConflict(id: number): never {
    throw RpcError.Domain('ResourceConflict', {
        message: 'alert instance is already resolved',
        details: {resourceType: 'alert_instance', identifier: id}
    });
}

function translateAlertRuleError(
    err: unknown,
    operation: AlertRuleOperation
): RpcError {
    if (err instanceof RpcError) return err;

    const pg = err as {code?: string; detail?: string};
    if (pg?.code === '23505') {
        return RpcError.Domain('ResourceConflict', {
            message: 'alert rule name already exists',
            details: {resourceType: 'alert_rule'}
        });
    }

    if (pg?.code === '23503' && operation === 'delete') {
        return RpcError.Domain('ResourceConflict', {
            message: 'alert rule is still referenced by alert instances',
            details: {resourceType: 'alert_rule'}
        });
    }

    if (pg?.code === '23503' && pg.detail === 'notification_endpoint') {
        return RpcError.Domain('ResourceNotFound', {
            message: 'channel not found',
            details: {resourceType: 'notification_endpoint'}
        });
    }

    if (pg?.code === '23503') {
        return RpcError.Domain('ResourceNotFound', {
            message: 'destination group not found',
            details: {resourceType: 'notification_destination_group'}
        });
    }

    return RpcError.OperationFailed(`Alert.Rule.${operation}`, err);
}

interface VirtualAlertCapabilityRow {
    external_id: string;
    role_key: string;
    source_external_id: string;
    source_component_key: string;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
}

async function virtualAlertCapabilityViews(
    organizationId: string
): Promise<Map<string, DeviceCapabilityView>> {
    const rows = await postgres.queryRows<VirtualAlertCapabilityRow>(
        `SELECT
                dl.external_id,
                binding.role_key,
                src.external_id AS source_external_id,
                binding.source_component_key,
                binding.source_snapshot_json,
                binding.role_metadata_json
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
            AND dl.deleted_at IS NULL
           JOIN device.virtual_device_binding binding
             ON binding.virtual_device_list_id = vd.device_list_id
            AND binding.organization_id = vd.organization_id
            AND binding.effective_from <= NOW()
            AND (
                 binding.effective_to IS NULL OR
                 binding.effective_to > NOW()
            )
           JOIN device.list src
             ON src.id = binding.source_device_list_id
            AND src.organization_id = binding.organization_id
            AND src.deleted_at IS NULL
          WHERE vd.organization_id = $1
            AND vd.deleted_at IS NULL
          ORDER BY dl.external_id, binding.role_key`,
        [organizationId]
    );
    const mutable = new Map<
        string,
        {
            entityTypes: Set<string>;
            entityIds: Set<string>;
            componentKeys: Set<string>;
            isBattery: boolean;
            bthomeObjNames: Set<string>;
        }
    >();
    const rowsByDevice = new Map<string, VirtualAlertCapabilityRow[]>();
    for (const row of rows) {
        const bucket = rowsByDevice.get(row.external_id) ?? [];
        bucket.push(row);
        rowsByDevice.set(row.external_id, bucket);
    }
    const componentIdsByDevice = new Map<string, Map<string, number>>();
    for (const [externalId, deviceRows] of rowsByDevice) {
        componentIdsByDevice.set(
            externalId,
            assignVirtualComponentIds(
                deviceRows.map((candidate) => {
                    const binding = {
                        roleKey: candidate.role_key,
                        sourceExternalId: candidate.source_external_id,
                        sourceComponentKey: candidate.source_component_key,
                        writable: false,
                        sourceSnapshot: candidate.source_snapshot_json,
                        roleMetadata: candidate.role_metadata_json
                    };
                    return {
                        roleKey: candidate.role_key,
                        sourceComponentKey: candidate.source_component_key,
                        entityType: virtualEntityType(binding)
                    };
                })
            )
        );
    }
    for (const row of rows) {
        const current = mutable.get(row.external_id) ?? {
            entityTypes: new Set<string>(),
            entityIds: new Set<string>(),
            componentKeys: new Set<string>(),
            isBattery: false,
            bthomeObjNames: new Set<string>()
        };
        const binding = {
            roleKey: row.role_key,
            sourceExternalId: row.source_external_id,
            sourceComponentKey: row.source_component_key,
            writable: false,
            sourceSnapshot: row.source_snapshot_json,
            roleMetadata: row.role_metadata_json
        };
        const entityType = virtualEntityType(binding);
        const componentId =
            componentIdsByDevice.get(row.external_id)?.get(row.role_key) ?? 0;
        current.entityTypes.add(entityType);
        current.entityIds.add(virtualEntityId(row.external_id, row.role_key));
        current.componentKeys.add(`${entityType}:${componentId}`);
        const objName = row.role_metadata_json?.objName;
        if (typeof objName === 'string') current.bthomeObjNames.add(objName);
        mutable.set(row.external_id, current);
    }
    return mutable;
}

export default class AlertComponent extends Component {
    constructor() {
        super('alert', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ALERT_DESCRIBE;
    }

    /** Fetch-one-row helper for fn_x_get DB functions. */
    async #fetchRow<T>(
        dbMethod: string,
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<T | undefined> {
        const result = await postgres.callMethod(
            dbMethod,
            {
                p_organization_id: organizationId,
                p_id: id
            },
            txId
        );
        return result?.rows?.[0] as T | undefined;
    }

    async #requireRow<T>(
        dbMethod: string,
        resource: string,
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<T> {
        const row = await this.#fetchRow<T>(dbMethod, organizationId, id, txId);
        if (!row) throw RpcError.NotFound(resource, id);
        return row;
    }

    #getRuleRow(
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<AlertRuleRow | undefined> {
        return this.#fetchRow<AlertRuleRow>(
            'notifications.fn_alert_rule_get',
            organizationId,
            id,
            txId
        );
    }

    async #requireRuleRow(
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<AlertRuleRow> {
        const row = await this.#requireRow<AlertRuleRow>(
            'notifications.fn_alert_rule_get',
            'alert_rule',
            organizationId,
            id,
            txId
        );
        await hydratePublicRuleScopes(organizationId, [row], txId);
        return row;
    }

    // One reusable replacer for both recipient kinds; the strategy map holds the
    // only per-kind difference (SQL fn + its JSONB param). pg-node sends JS
    // arrays as PG array literals, so the id list goes over as JSON.
    async #replaceRuleDestinations(
        kind: RuleDestinationKind,
        organizationId: string,
        ruleId: number,
        ids: number[],
        txId?: number
    ): Promise<void> {
        const replacer = RULE_DESTINATION_REPLACERS[kind];
        await postgres.callMethod(
            replacer.fn,
            {
                p_organization_id: organizationId,
                p_rule_id: ruleId,
                [replacer.param]: JSON.stringify(ids)
            },
            txId
        );
    }

    // The same reach Instance.List applies, in one round trip.
    async #instanceRowsInReach(
        sender: CommandSender,
        organizationId: string,
        ids: number[]
    ): Promise<AlertInstanceRow[]> {
        if (ids.length === 0) return [];
        const result = await postgres.callMethod(
            'notifications.fn_alert_instance_get_many',
            {
                p_organization_id: organizationId,
                p_ids: ids,
                ...reachParams(await alertReach(sender))
            }
        );
        return (result?.rows ?? []) as AlertInstanceRow[];
    }

    #getInstanceRow(
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<AlertInstanceRow | undefined> {
        return this.#fetchRow<AlertInstanceRow>(
            'notifications.fn_alert_instance_get',
            organizationId,
            id,
            txId
        );
    }

    // Out of reach reads as denied, so a scoped caller cannot probe which
    // ids exist; an unnarrowed caller still gets not-found.
    async #requireInstanceRowInReach(
        sender: CommandSender,
        organizationId: string,
        id: number,
        reach: AccessibleReach | null
    ): Promise<AlertInstanceRow> {
        const result = await postgres.callMethod(
            'notifications.fn_alert_instance_get',
            {
                p_organization_id: organizationId,
                p_id: id,
                ...reachParams(reach)
            }
        );
        const row = result?.rows?.[0] as AlertInstanceRow | undefined;
        if (!row && reach === null) {
            throw RpcError.NotFound('alert_instance', id);
        }
        if (!row) throw RpcError.PermissionDenied(sender.isAuthenticated());
        await hydratePublicAlertSubjects(organizationId, [row]);
        return row;
    }

    // An annotation id names no alert, so ask whether its alert is in reach.
    async #requireAnnotationInWriteReach(
        sender: CommandSender,
        organizationId: string,
        id: number
    ): Promise<void> {
        const reach = await alertWriteReach(sender);
        if (reach === null) return;
        const result = await postgres.callMethod(
            'notifications.fn_alert_annotation_in_reach',
            {p_organization_id: organizationId, p_id: id, ...reachParams(reach)}
        );
        const row = result?.rows?.[0] as
            | {fn_alert_annotation_in_reach?: boolean}
            | undefined;
        if (row?.fn_alert_annotation_in_reach) return;
        throw RpcError.PermissionDenied(sender.isAuthenticated());
    }

    async #applyInstanceAction(
        organizationId: string,
        id: number,
        action: AlertTransitionAction,
        actor: {userId: string; displayName: string | null},
        options?: {
            silencedUntil?: string | null;
            silenceReason?: string | null;
            transitionData?: JsonRecord;
            ackComment?: string | null;
        }
    ): Promise<AlertInstanceRow | undefined> {
        const result = await postgres.callMethod(
            'notifications.fn_alert_instance_apply_action',
            {
                p_organization_id: organizationId,
                p_id: id,
                p_action: action,
                p_actor_user_id: actor.userId,
                p_actor_display_name: actor.displayName,
                p_silenced_until: options?.silencedUntil ?? null,
                p_silence_reason: options?.silenceReason ?? null,
                p_transition_data: options?.transitionData ?? {},
                p_ack_comment: options?.ackComment ?? null
            }
        );

        const row = result?.rows?.[0] as AlertInstanceRow | undefined;
        if (row) {
            // Only this alert moved; the tenant's other alert state still holds.
            noteOperatorAlertChange(row);
            await hydratePublicAlertSubjects(organizationId, [row]);
        }
        return row;
    }

    // OWASP A09:2025 — every alert-instance state transition is logged with
    // operator + rule + device context so incident retros can reconstruct
    // who silenced / ack'd / resolved which incident.
    #auditInstanceTransition(
        operation: AlertInstanceAuditOperation,
        sender: CommandSender,
        row: AlertInstanceRow,
        extras: {silencedUntil?: string; silenceReason?: string | null} = {}
    ): void {
        void authzAuditWriter.writeAlertInstanceEvent({
            tenantId: row.organization_id,
            actorId: authzAuditActor(sender.getUser?.()),
            operation,
            instanceId: row.id,
            ruleId: row.rule_id ?? null,
            ruleKind: row.rule_kind ?? null,
            deviceId:
                row.source_subject_type === 'device'
                    ? row.source_subject_id
                    : null,
            ...extras
        });
    }

    @Component.NoAudit
    @Component.Expose('Rule.ListKinds')
    @Component.CrudPermission('alerts', 'read')
    listRuleKinds(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params,
            ALERT_RULE_LIST_KINDS_PARAMS_SCHEMA
        );
        return {
            items: ALERT_RULE_KIND_DESCRIPTORS.map((item) => ({
                ...item,
                supportedScopeTypes: [...item.supportedScopeTypes]
            }))
        };
    }

    async #devicesForPathDiscovery(
        params: {shellyID?: string},
        sender: CommandSender
    ) {
        if (params.shellyID) {
            const canRead = isComponentPermissionAllowed(
                await canPerformComponentOperationAsync(
                    sender,
                    'devices',
                    'read',
                    params.shellyID
                )
            );
            if (!canRead && !canCrossOrganizationBoundary(sender)) {
                throw RpcError.Unauthorized();
            }
            const dev = DeviceCollector.getDevice(params.shellyID);
            return dev ? [dev] : [];
        }

        const all = DeviceCollector.getAll();
        if (canCrossOrganizationBoundary(sender)) return all;

        const accessible = await sender.filterAccessibleDevices(
            all.map((d) => d.shellyID)
        );
        return all.filter((d) => accessible.has(d.shellyID));
    }

    async #bluetoothMetricPathsForDiscovery(
        params: {organizationId?: string; shellyID?: string},
        sender: CommandSender
    ) {
        const orgId = sender.getOrganizationId() ?? params.organizationId;
        if (!orgId) return [];
        const devices = await this.#bluetoothDevicesForPathDiscovery(
            orgId,
            params,
            sender
        );
        return devices.flatMap((device) => {
            const snapshot = bluetoothDeviceSnapshot({
                device,
                gateway: bluetoothGatewaySnapshot(device)
            });
            return collectBluetoothMetrics(device, snapshot.status ?? {});
        });
    }

    async #virtualStatusForPathDiscovery(
        params: {organizationId?: string; shellyID?: string},
        sender: CommandSender
    ): Promise<Record<string, unknown>> {
        const orgId = sender.getOrganizationId() ?? params.organizationId;
        if (!orgId) return {};
        const entities = await listVirtualEntities(
            {
                organizationId: orgId,
                ...(params.shellyID
                    ? {deviceExternalIds: [params.shellyID]}
                    : {})
            },
            {
                queryRows: postgres.queryRows,
                getSourceSnapshot:
                    createDeviceCollectorSnapshotFetcher(DeviceCollector)
            }
        );
        const allowed = params.shellyID
            ? new Set([params.shellyID])
            : canCrossOrganizationBoundary(sender)
              ? new Set(entities.map((entity) => entity.deviceExternalId))
              : await sender.filterAccessibleDevices(
                    entities.map((entity) => entity.deviceExternalId)
                );
        const selected = entities.filter((entity) =>
            allowed.has(entity.deviceExternalId)
        );
        const status: Record<string, unknown> = {};
        const byDevice = new Map<string, VirtualEntityResolution[]>();
        for (const entity of selected) {
            const bucket = byDevice.get(entity.deviceExternalId) ?? [];
            bucket.push(entity);
            byDevice.set(entity.deviceExternalId, bucket);
        }
        for (const deviceEntities of byDevice.values()) {
            const ids = assignVirtualComponentIds(
                deviceEntities.map((entity) => ({
                    roleKey: entity.roleKey,
                    sourceComponentKey: entity.sourceComponentKey,
                    entityType: entity.entity.type
                }))
            );
            for (const entity of deviceEntities) {
                status[
                    `${entity.entity.type}:${ids.get(entity.roleKey) ?? 0}`
                ] = entity.status;
            }
        }
        return status;
    }

    async #bluetoothComponentPathsForDiscovery(
        params: {organizationId?: string; shellyID?: string},
        sender: CommandSender
    ) {
        const orgId = sender.getOrganizationId() ?? params.organizationId;
        if (!orgId) return [];
        const devices = await this.#bluetoothDevicesForPathDiscovery(
            orgId,
            params,
            sender
        );
        return devices.flatMap((device) => {
            const snapshot = bluetoothDeviceSnapshot({
                device,
                gateway: bluetoothGatewaySnapshot(device)
            });
            return collectBluetoothComponentPaths(
                device,
                snapshot.status ?? {}
            );
        });
    }

    async #bluetoothDevicesForPathDiscovery(
        orgId: string,
        params: {shellyID?: string},
        sender: CommandSender
    ) {
        if (params.shellyID) {
            const device = await getBluetoothDevice(orgId, params.shellyID);
            return device ? [device] : [];
        }
        const page = await listBluetoothDevices(orgId, {limit: 0});
        if (canCrossOrganizationBoundary(sender)) return page.items;
        const accessible = await sender.filterAccessibleDevices(
            page.items.map((d) => d.externalId)
        );
        return page.items.filter((d) => accessible.has(d.externalId));
    }

    /** Discover numeric metrics the component_threshold rule builder can target. */
    @Component.NoAudit
    @Component.Expose('Rule.ListMetricPaths')
    @Component.CrudPermission('alerts', 'read', NOT_A_RULE_ID)
    async listMetricPaths(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; shellyID?: string}>(
            params,
            ALERT_RULE_LIST_METRIC_PATHS_PARAMS_SCHEMA
        );
        const virtualStatus = await this.#virtualStatusForPathDiscovery(
            p,
            sender
        );
        return {
            items: [
                ...collectMetrics(
                    await this.#devicesForPathDiscovery(p, sender)
                ),
                ...(await this.#bluetoothMetricPathsForDiscovery(p, sender)),
                ...scanStatusMetrics(virtualStatus)
            ]
        };
    }

    /** Discover metric and state component paths for alert rule builders. */
    @Component.NoAudit
    @Component.Expose('Rule.ListComponentPaths')
    @Component.CrudPermission('alerts', 'read', NOT_A_RULE_ID)
    async listComponentPaths(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; shellyID?: string}>(
            params,
            ALERT_RULE_LIST_COMPONENT_PATHS_PARAMS_SCHEMA
        );
        const virtualStatus = await this.#virtualStatusForPathDiscovery(
            p,
            sender
        );
        return {
            items: [
                ...collectComponentPaths(
                    await this.#devicesForPathDiscovery(p, sender)
                ),
                ...(await this.#bluetoothComponentPathsForDiscovery(p, sender)),
                ...scanStatusMetrics(virtualStatus).map((metric) => ({
                    ...metric,
                    kind: 'metric' as const,
                    valueType: 'number' as const
                })),
                ...scanStatusStates(virtualStatus)
            ]
        };
    }

    @Component.Expose('Rule.ListEligibleDevices')
    @Component.CrudPermission('alerts', 'read')
    async listEligibleDevices(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            kind: AlertRuleKind;
            config?: Record<string, unknown>;
        }>(params, ALERT_RULE_LIST_ELIGIBLE_DEVICES_PARAMS_SCHEMA);
        const config = p.config ?? {};
        if (p.kind === 'device_offline') {
            const orgId = requireOrganizationId(sender, p);
            const rows = await postgres.queryRows<{external_id: string}>(
                `SELECT external_id
                   FROM device.list
                  WHERE organization_id = $1
                    AND external_id IS NOT NULL
                    AND deleted_at IS NULL
                  ORDER BY external_id`,
                [orgId]
            );
            const ids = rows.map((r) => r.external_id);
            const visibleIds = canCrossOrganizationBoundary(sender)
                ? ids
                : [...(await sender.filterAccessibleDevices(ids))];
            return {shellyIDs: visibleIds};
        }
        const all = DeviceCollector.getAll();
        const visible = canCrossOrganizationBoundary(sender)
            ? all
            : await (async () => {
                  const accessible = await sender.filterAccessibleDevices(
                      all.map((d) => d.shellyID)
                  );
                  return all.filter((d) => accessible.has(d.shellyID));
              })();
        const shellyIDs = visible
            .filter((d) =>
                deviceSupportsKind(capabilityViewOf(d), p.kind, config)
            )
            .map((d) => d.shellyID);
        const requestedOrgId =
            p.organizationId ??
            (
                sender as CommandSender & {
                    getOrganizationId?: () => string | undefined;
                }
            ).getOrganizationId?.();
        const virtualViews = requestedOrgId
            ? await virtualAlertCapabilityViews(requestedOrgId)
            : new Map<string, DeviceCapabilityView>();
        const virtualIds = [...virtualViews.keys()];
        const accessibleVirtual = canCrossOrganizationBoundary(sender)
            ? new Set(virtualIds)
            : await sender.filterAccessibleDevices(virtualIds);
        for (const [externalId, view] of virtualViews) {
            if (!accessibleVirtual.has(externalId)) continue;
            if (deviceSupportsKind(view, p.kind, config)) {
                shellyIDs.push(externalId);
            }
        }
        for (const externalId of await this.#eligibleBluetoothDevices(
            {organizationId: requestedOrgId, kind: p.kind, config},
            sender
        )) {
            shellyIDs.push(externalId);
        }
        return {shellyIDs: [...new Set(shellyIDs)]};
    }

    // Promoted BLU devices are their own list rows, so a scope that names one
    // must be offered here. Rule.ListComponentPaths already surfaces their
    // paths; without this the picker offered a condition no device could host.
    async #eligibleBluetoothDevices(
        query: {
            organizationId: string | undefined;
            kind: AlertRuleKind;
            config: Record<string, unknown>;
        },
        sender: CommandSender
    ): Promise<string[]> {
        if (!query.organizationId) return [];
        const devices = await this.#bluetoothDevicesForPathDiscovery(
            query.organizationId,
            {},
            sender
        );
        return devices
            .filter((device) =>
                deviceSupportsKind(
                    bluetoothCapabilityView({
                        components: device.components,
                        status:
                            bluetoothDeviceSnapshot({
                                device,
                                gateway: bluetoothGatewaySnapshot(device)
                            }).status ?? {}
                    }),
                    query.kind,
                    query.config
                )
            )
            .map((device) => device.externalId);
    }

    @Component.NoAudit
    @Component.Expose('Rule.List')
    @Component.CrudPermission('alerts', 'read')
    async listRules(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            enabled?: boolean;
            kind?: AlertRuleKind;
            query?: string;
            limit?: number;
            offset?: number;
        }>(params, ALERT_RULE_LIST_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        try {
            const reach = await alertReach(sender);
            const result = await postgres.callMethod(
                'notifications.fn_alert_rule_list',
                {
                    p_organization_id: organizationId,
                    p_enabled: p.enabled ?? null,
                    p_kind: p.kind ?? null,
                    p_query: p.query?.trim() || null,
                    p_limit: limit,
                    p_offset: offset,
                    ...reachParams(reach),
                    p_reach_tag_ids: reach ? [...reach.tagIds] : null
                }
            );
            const rows = (result?.rows ?? []) as AlertRuleListRow[];
            await hydratePublicRuleScopes(
                organizationId,
                rows as AlertRuleRow[]
            );
            const total =
                rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
            const items: AlertRule[] = [];

            for (const row of rows) {
                if (row.id == null) continue;
                items.push(rowToAlertRule(row as AlertRuleRow));
            }

            return buildListResponse(items, total, limit, offset);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Rule.List', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('Rule.Get')
    @Component.CrudPermission('alerts', 'read', (p) => p?.id)
    async getRule(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_RULE_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);

        try {
            return rowToAlertRule(
                await this.#requireRuleRow(organizationId, p.id)
            );
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Rule.Get', err);
        }
    }

    @Component.Expose('Rule.Create')
    @Component.CrudPermission('alerts', 'create')
    async createRule(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            name: string;
            kind: AlertRuleKind;
            enabled?: boolean;
            severity: AlertSeverity;
            scope: ScopeSelector;
            dedupeWindowSec?: number;
            cooldownSec?: number;
            destinationGroupIds?: number[];
            destinationChannelIds?: number[];
            ownerUserId?: string | null;
            summaryTemplate?: string | null;
            messageTemplate?: string | null;
            autoResolve?: boolean;
            triggerOnce?: boolean;
            config?: JsonRecord;
            groupBy?: string[] | null;
            deliveryMode?: 'instant' | 'digest';
            digestWindowMinutes?: number | null;
            activeWindow?: unknown;
            runbookUrl?: string | null;
            templateId?: number | null;
        }>(params, ALERT_RULE_CREATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const groupIds = normalizeDestinationGroupIds(p.destinationGroupIds);
        const channelIds = normalizeDestinationChannelIds(
            p.destinationChannelIds
        );
        assertRuleHasRecipient({channelIds, groupIds});

        try {
            return await this.#performRuleCreate(organizationId, {
                name: normalizeName(p.name, 'Alert rule name'),
                kind: p.kind,
                severity: p.severity,
                enabled: p.enabled ?? true,
                scope: validateSupportedScopeSelector(p.kind, p.scope),
                dedupeWindowSec: p.dedupeWindowSec ?? 0,
                cooldownSec: p.cooldownSec ?? 0,
                destinationGroupIds: groupIds,
                destinationChannelIds: channelIds,
                ownerUserId: normalizeOptionalUserId(p.ownerUserId),
                summaryTemplate: normalizeOptionalText(p.summaryTemplate),
                messageTemplate: normalizeOptionalText(p.messageTemplate),
                autoResolve: resolveAlertRuleAutoResolve(p.kind, p.autoResolve),
                triggerOnce: p.triggerOnce === true,
                config: normalizeAlertRuleConfig(p.kind, p.config),
                groupBy: normalizeGroupBy(p.groupBy),
                deliveryMode:
                    p.deliveryMode === 'digest' ? 'digest' : 'instant',
                activeWindow: readActiveWindow(p.activeWindow),
                digestWindowMinutes:
                    typeof p.digestWindowMinutes === 'number' &&
                    p.digestWindowMinutes >= 1
                        ? p.digestWindowMinutes
                        : null,
                runbookUrl: normalizeOptionalText(p.runbookUrl),
                templateId:
                    typeof p.templateId === 'number' && p.templateId > 0
                        ? p.templateId
                        : null
            });
        } catch (err: unknown) {
            throw translateAlertRuleError(err, 'create');
        }
    }

    // Single creation path. Shared by Rule.Create and Rule.CreateFromTemplate
    // so both flows produce an identical row + destination-group mapping.
    async #performRuleCreate(
        organizationId: string,
        spec: RuleCreateSpec
    ): Promise<AlertRule> {
        return await withPostgresTransaction(async (txId, ctx) => {
            const result = await postgres.callMethod(
                'notifications.fn_alert_rule_create',
                {
                    p_organization_id: organizationId,
                    p_name: spec.name,
                    p_kind: storedAlertRuleKind(spec.kind),
                    p_enabled: spec.enabled,
                    p_severity: spec.severity,
                    p_scope: storageScopeSelector(spec.scope),
                    p_dedupe_window_sec: spec.dedupeWindowSec,
                    p_cooldown_sec: spec.cooldownSec,
                    p_owner_user_id: spec.ownerUserId,
                    p_summary_template: spec.summaryTemplate,
                    p_message_template: spec.messageTemplate,
                    p_auto_resolve: spec.autoResolve,
                    p_trigger_once: spec.triggerOnce,
                    p_config: spec.config,
                    p_group_by: spec.groupBy,
                    p_delivery_mode: spec.deliveryMode,
                    p_digest_window_minutes: spec.digestWindowMinutes,
                    p_active_window: spec.activeWindow,
                    p_runbook_url: spec.runbookUrl,
                    p_template_id: spec.templateId
                },
                txId
            );
            const row = result?.rows?.[0] as AlertRuleRow | undefined;
            if (!row) throw RpcError.OperationFailed('Alert.Rule.Create');

            await replaceRuleSubjectScope(
                organizationId,
                row.id,
                spec.scope,
                txId
            );

            await this.#replaceRuleDestinations(
                'groups',
                organizationId,
                row.id,
                spec.destinationGroupIds,
                txId
            );
            await this.#replaceRuleDestinations(
                'channels',
                organizationId,
                row.id,
                spec.destinationChannelIds,
                txId
            );

            const created = rowToAlertRule(
                await this.#requireRuleRow(organizationId, row.id, txId)
            );
            ctx.onCommit(() => {
                invalidateAlertRuleCache(organizationId);
                invalidateAlertRecipientsCache(organizationId);
                AlertEvents.emitAlertRuleCreated({
                    organizationId,
                    ruleId: created.id,
                    name: created.name
                });
                if (created.enabled) {
                    scheduleInitialRuleEvaluation({
                        organizationId,
                        ruleId: created.id,
                        reason: 'create'
                    });
                }
            });
            return created;
        });
    }

    @Component.Expose('Rule.Update')
    @Component.CrudPermission('alerts', 'update', (p) => p?.id)
    async updateRule(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                enabled?: boolean;
                severity?: AlertSeverity;
                scope?: ScopeSelector;
                dedupeWindowSec?: number;
                cooldownSec?: number;
                destinationGroupIds?: number[];
                destinationChannelIds?: number[];
                ownerUserId?: string | null;
                summaryTemplate?: string | null;
                messageTemplate?: string | null;
                autoResolve?: boolean;
                triggerOnce?: boolean;
                config?: JsonRecord;
                groupBy?: string[] | null;
                deliveryMode?: 'instant' | 'digest';
                digestWindowMinutes?: number | null;
                activeWindow?: unknown;
                runbookUrl?: string | null;
                templateId?: number | null;
            };
        }>(params, ALERT_RULE_UPDATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const patch = p.patch ?? {};

        try {
            const current = await this.#requireRuleRow(organizationId, p.id);
            const currentKind = publicAlertRuleKind(current.kind);
            if (Object.keys(patch).length === 0) {
                return rowToAlertRule(current);
            }

            const nextScope =
                patch.scope !== undefined
                    ? validateSupportedScopeSelector(currentKind, patch.scope)
                    : publicScopeSelector(current.scope);
            const nextConfig =
                patch.config !== undefined
                    ? normalizeAlertRuleConfig(currentKind, patch.config)
                    : cloneRecord(current.config);
            const nextAutoResolve =
                patch.autoResolve !== undefined
                    ? resolveAlertRuleAutoResolve(
                          currentKind,
                          patch.autoResolve
                      )
                    : current.auto_resolve;
            const nextDestinationGroupIds =
                patch.destinationGroupIds !== undefined
                    ? normalizeDestinationGroupIds(patch.destinationGroupIds)
                    : null;
            const nextDestinationChannelIds =
                patch.destinationChannelIds !== undefined
                    ? normalizeDestinationChannelIds(
                          patch.destinationChannelIds
                      )
                    : null;
            // When a recipient list is edited, the resulting rule must still
            // reach someone — check the final (patched ∪ unchanged) state.
            if (
                nextDestinationGroupIds !== null ||
                nextDestinationChannelIds !== null
            ) {
                assertRuleHasRecipient({
                    groupIds:
                        nextDestinationGroupIds ??
                        toIntArray(current.destination_group_ids),
                    channelIds:
                        nextDestinationChannelIds ??
                        toIntArray(current.destination_channel_ids)
                });
            }

            return await withPostgresTransaction(async (txId, ctx) => {
                const result = await postgres.callMethod(
                    'notifications.fn_alert_rule_update',
                    {
                        p_organization_id: organizationId,
                        p_id: p.id,
                        p_name:
                            patch.name !== undefined
                                ? normalizeName(patch.name, 'Alert rule name')
                                : null,
                        p_enabled: patch.enabled ?? null,
                        p_severity: patch.severity ?? null,
                        p_scope:
                            patch.scope !== undefined
                                ? storageScopeSelector(nextScope)
                                : null,
                        p_dedupe_window_sec: patch.dedupeWindowSec ?? null,
                        p_cooldown_sec: patch.cooldownSec ?? null,
                        p_owner_user_id:
                            patch.ownerUserId !== undefined
                                ? normalizeOptionalUserId(patch.ownerUserId)
                                : null,
                        p_clear_owner_user_id: patch.ownerUserId === null,
                        p_summary_template:
                            patch.summaryTemplate !== undefined
                                ? normalizeOptionalText(patch.summaryTemplate)
                                : null,
                        p_clear_summary_template:
                            patch.summaryTemplate === null,
                        p_message_template:
                            patch.messageTemplate !== undefined
                                ? normalizeOptionalText(patch.messageTemplate)
                                : null,
                        p_clear_message_template:
                            patch.messageTemplate === null,
                        p_auto_resolve:
                            patch.autoResolve !== undefined
                                ? nextAutoResolve
                                : null,
                        // NULL leaves the stored flag alone, matching every
                        // other optional field on this patch.
                        p_trigger_once: patch.triggerOnce ?? null,
                        p_config:
                            patch.config !== undefined ? nextConfig : null,
                        p_group_by:
                            patch.groupBy !== undefined &&
                            patch.groupBy !== null
                                ? normalizeGroupBy(patch.groupBy)
                                : null,
                        p_clear_group_by: patch.groupBy === null,
                        p_delivery_mode: patch.deliveryMode ?? null,
                        p_digest_window_minutes:
                            typeof patch.digestWindowMinutes === 'number' &&
                            patch.digestWindowMinutes >= 1
                                ? patch.digestWindowMinutes
                                : null,
                        p_clear_digest_window:
                            patch.digestWindowMinutes === null,
                        p_active_window: readActiveWindow(patch.activeWindow),
                        p_clear_active_window: patch.activeWindow === null,
                        p_runbook_url:
                            patch.runbookUrl !== undefined
                                ? normalizeOptionalText(patch.runbookUrl)
                                : null,
                        p_clear_runbook_url: patch.runbookUrl === null,
                        p_template_id:
                            typeof patch.templateId === 'number' &&
                            patch.templateId > 0
                                ? patch.templateId
                                : null,
                        p_clear_template_id:
                            patch.templateId === null || patch.templateId === 0
                    },
                    txId
                );
                const row = result?.rows?.[0] as AlertRuleRow | undefined;
                if (!row) throw RpcError.NotFound('alert_rule', p.id);

                if (patch.scope !== undefined) {
                    await replaceRuleSubjectScope(
                        organizationId,
                        row.id,
                        nextScope,
                        txId
                    );
                }

                if (nextDestinationGroupIds !== null) {
                    await this.#replaceRuleDestinations(
                        'groups',
                        organizationId,
                        row.id,
                        nextDestinationGroupIds,
                        txId
                    );
                }
                if (nextDestinationChannelIds !== null) {
                    await this.#replaceRuleDestinations(
                        'channels',
                        organizationId,
                        row.id,
                        nextDestinationChannelIds,
                        txId
                    );
                }

                const updated = rowToAlertRule(
                    await this.#requireRuleRow(organizationId, row.id, txId)
                );
                ctx.onCommit(() => {
                    invalidateAlertRuleCache(organizationId);
                    invalidateAlertRecipientsCache(organizationId);
                    AlertEvents.emitAlertRuleUpdated({
                        organizationId,
                        ruleId: updated.id,
                        name: updated.name
                    });
                    // Window/field math lives in config; a config edit must
                    // drop stale evaluator state so the new tuning rebuilds
                    // its window instead of reusing the old samples.
                    if (patch.config !== undefined) {
                        clearAnomalyBandCacheForRule(p.id);
                        clearChangeEventCacheForRule(p.id);
                    }
                    if (updated.enabled) {
                        scheduleInitialRuleEvaluation({
                            organizationId,
                            ruleId: updated.id,
                            reason:
                                current.enabled === false &&
                                patch.enabled === true
                                    ? 'enable'
                                    : 'update'
                        });
                    }
                });
                return updated;
            });
        } catch (err: unknown) {
            throw translateAlertRuleError(err, 'update');
        }
    }

    @Component.Expose('Rule.Delete')
    @Component.CrudPermission('alerts', 'delete', (p) => p?.id)
    async deleteRule(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean; id: number}> {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_RULE_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);

        try {
            await this.#requireRuleRow(organizationId, p.id);
            // A deleted rule is never evaluated again, so its open alerts
            // are closed in the same transaction; nothing else ever would.
            const userId = sender.getUserId();
            const actorUserId =
                userId && userId !== '<UNAUTHORIZED>' ? userId : null;
            const {deleted, closed} = await withPostgresTransaction(
                async (txId) => {
                    const closedResult = await postgres.callMethod(
                        'notifications.fn_alert_rule_resolve_open_instances',
                        {
                            p_organization_id: organizationId,
                            p_rule_id: p.id,
                            p_actor_user_id: actorUserId,
                            p_actor_display_name: actorDisplayName(sender)
                        },
                        txId
                    );
                    const result = await postgres.callMethod(
                        'notifications.fn_alert_rule_delete',
                        {
                            p_organization_id: organizationId,
                            p_id: p.id
                        },
                        txId
                    );
                    const row = result?.rows?.[0] as {id?: number} | undefined;
                    return {
                        deleted: row?.id != null,
                        closed: (closedResult?.rows ?? []) as AlertInstanceRow[]
                    };
                }
            );
            if (deleted) {
                invalidateAlertRuleCache(organizationId);
                invalidateAlertRecipientsCache(organizationId);
                // Evaluator state is keyed by rule id and never expires on
                // its own — deleted rules must release it.
                clearAnomalyBandCacheForRule(p.id);
                clearChangeEventCacheForRule(p.id);
                for (const row of closed) {
                    emitAlertInstanceEvent('Alert.Resolved', row);
                }
                AlertEvents.emitAlertRuleDeleted({
                    organizationId,
                    ruleId: p.id
                });
            }
            return {deleted, id: p.id};
        } catch (err: unknown) {
            throw translateAlertRuleError(err, 'delete');
        }
    }

    // Normalize inputs the same way Rule.Create does so the hash matches
    // what a subsequent Create/Update would land in the DB.
    @Component.NoAudit
    @Component.Expose('Rule.CheckDuplicate')
    @Component.CrudPermission('alerts', 'read')
    async checkDuplicateRule(
        params: unknown,
        sender: CommandSender
    ): Promise<{duplicate: {id: number; name: string} | null}> {
        const p = validateOrThrow<{
            organizationId?: string;
            kind: AlertRuleKind;
            severity: AlertSeverity;
            scope: ScopeSelector;
            dedupeWindowSec?: number;
            cooldownSec?: number;
            config?: JsonRecord;
            excludeId?: number;
        }>(params, ALERT_RULE_CHECK_DUPLICATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const scope = validateSupportedScopeSelector(p.kind, p.scope);
        const config = normalizeAlertRuleConfig(p.kind, p.config);

        const result = await postgres.callMethod(
            'notifications.fn_alert_rule_find_duplicate',
            {
                p_organization_id: organizationId,
                p_kind: p.kind,
                p_severity: p.severity,
                p_scope: scope,
                p_config: config,
                p_dedupe_window_sec: p.dedupeWindowSec ?? 0,
                p_cooldown_sec: p.cooldownSec ?? 0,
                p_exclude_id: p.excludeId ?? null
            }
        );
        const row = result?.rows?.[0] as {id: number; name: string} | undefined;
        return {duplicate: row ?? null};
    }

    @Component.NoAudit
    @Component.Expose('Rule.ListTemplates')
    @Component.CrudPermission('alerts', 'read')
    async listRuleTemplates(
        params: unknown,
        sender: CommandSender
    ): Promise<{items: AlertRuleTemplate[]}> {
        const p = validateOrThrow<{category?: string}>(
            params,
            ALERT_RULE_LIST_TEMPLATES_PARAMS_SCHEMA
        );
        const result = await postgres.callMethod(
            'notifications.fn_alert_rule_template_list',
            {
                p_organization_id: requireOrganizationId(sender),
                p_category: p.category?.trim() || null
            }
        );
        const rows = (result?.rows ?? []) as AlertRuleTemplateRow[];
        return {items: rows.map(rowToAlertRuleTemplate)};
    }

    @Component.NoAudit
    @Component.Expose('Rule.ListFirings')
    @Component.CrudPermission('alerts', 'read', (p) => p?.id)
    async listRuleFirings(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
        }>(params, ALERT_RULE_LIST_FIRINGS_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        try {
            // Scope guard — rule must exist in caller's org before we
            // expose its firing history.
            await this.#requireRuleRow(organizationId, p.id);

            const result = await postgres.callMethod(
                'notifications.fn_alert_rule_list_firings',
                {
                    p_organization_id: organizationId,
                    p_rule_id: p.id,
                    p_limit: limit,
                    p_offset: offset
                }
            );
            const rows = (result?.rows ?? []) as AlertRuleFiringListRow[];
            await hydratePublicAlertSubjects(
                organizationId,
                rows as AlertRuleFiringRow[]
            );
            const total =
                rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
            const items: AlertRuleFiring[] = [];

            for (const row of rows) {
                if (row.transition_id == null) continue;
                items.push(
                    rowToAlertRuleFiring(
                        row as AlertRuleFiringRow,
                        organizationId
                    )
                );
            }

            return buildListResponse(items, total, limit, offset);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Rule.ListFirings', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('Rule.Preview')
    @Component.CrudPermission('alerts', 'read')
    async previewRule(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            ruleId?: number;
            kind?: AlertRuleKind;
            severity?: AlertSeverity;
            scope?: ScopeSelector;
            config?: JsonRecord;
            dedupeWindowSec?: number;
            cooldownSec?: number;
        }>(params, ALERT_RULE_PREVIEW_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);

        const rule = await this.#resolvePreviewRule(organizationId, p);
        const allDeviceIds = DeviceCollector.getAll().map((d) => d.shellyID);
        const accessible = await sender.filterAccessibleDevices(allDeviceIds);

        return await previewRuleAgainstOrg({
            organizationId,
            rule,
            accessibleDeviceIds: accessible
        });
    }

    async #resolvePreviewRule(
        organizationId: string,
        input: {
            ruleId?: number;
            kind?: AlertRuleKind;
            severity?: AlertSeverity;
            scope?: ScopeSelector;
            config?: JsonRecord;
            dedupeWindowSec?: number;
            cooldownSec?: number;
        }
    ): Promise<LoadedAlertRule> {
        if (input.ruleId !== undefined) {
            const row = await this.#requireRuleRow(
                organizationId,
                input.ruleId
            );
            // Shared mapper — same LoadedAlertRule shape the engine cache uses.
            return rowToLoadedRule(row);
        }

        if (
            input.kind === undefined ||
            input.severity === undefined ||
            input.scope === undefined
        ) {
            throw RpcError.InvalidParams(
                'Alert.Rule.Preview requires either ruleId or (kind + severity + scope).'
            );
        }

        const familyMapping = ALERT_KIND_TO_FAMILY[input.kind];
        return {
            id: 0,
            organizationId,
            name: 'preview',
            // A preview never fires, so it can never spend a one-shot.
            triggerOnce: false,
            templateId: null,
            kind: input.kind,
            conditionFamily: familyMapping.family,
            conditionSubkind: familyMapping.subkind,
            severity: input.severity,
            scope: validateSupportedScopeSelector(input.kind, input.scope),
            dedupeWindowSec: input.dedupeWindowSec ?? 0,
            cooldownSec: input.cooldownSec ?? 0,
            ownerUserId: null,
            summaryTemplate: null,
            messageTemplate: null,
            autoResolve: resolveAlertRuleAutoResolve(input.kind),
            config: normalizeAlertRuleConfig(input.kind, input.config),
            destinationGroupIds: [],
            destinationChannelIds: [],
            groupBy: null,
            deliveryMode: 'instant',
            digestWindowMinutes: null,
            activeWindow: null,
            runbookUrl: null,
            labelsTemplate: {}
        };
    }

    @Component.Expose('Rule.CreateFromTemplate')
    @Component.CrudPermission('alerts', 'create')
    async createRuleFromTemplate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            templateKey: string;
            name: string;
            scope: ScopeSelector;
            destinationGroupIds?: number[];
            destinationChannelIds?: number[];
            enabled?: boolean;
            ownerUserId?: string | null;
            configOverride?: JsonRecord;
            summaryTemplateOverride?: string | null;
            messageTemplateOverride?: string | null;
        }>(params, ALERT_RULE_CREATE_FROM_TEMPLATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const groupIds = normalizeDestinationGroupIds(p.destinationGroupIds);
        const channelIds = normalizeDestinationChannelIds(
            p.destinationChannelIds
        );
        assertRuleHasRecipient({channelIds, groupIds});

        try {
            const template = await this.#requireTemplate(
                p.templateKey,
                organizationId
            );
            if (!template.available || template.kind === null) {
                throw RpcError.InvalidRequest(
                    template.unavailableReason ??
                        'This alert template is not available.'
                );
            }

            // Caller-supplied config is merged over the template default
            // so a template can supply sane defaults while still letting
            // the UI tweak individual fields (e.g. threshold).
            const mergedConfig = {
                ...cloneRecord(template.config),
                ...(p.configOverride ?? {})
            };

            return await this.#performRuleCreate(organizationId, {
                name: normalizeName(p.name, 'Alert rule name'),
                kind: template.kind,
                severity: template.severity,
                enabled: p.enabled ?? true,
                scope: validateSupportedScopeSelector(template.kind, p.scope),
                dedupeWindowSec: template.dedupeWindowSec,
                cooldownSec: template.cooldownSec,
                destinationGroupIds: groupIds,
                destinationChannelIds: channelIds,
                ownerUserId: normalizeOptionalUserId(p.ownerUserId),
                summaryTemplate:
                    p.summaryTemplateOverride !== undefined
                        ? normalizeOptionalText(p.summaryTemplateOverride)
                        : template.summaryTemplate,
                messageTemplate:
                    p.messageTemplateOverride !== undefined
                        ? normalizeOptionalText(p.messageTemplateOverride)
                        : template.messageTemplate,
                autoResolve: resolveAlertRuleAutoResolve(
                    template.kind,
                    template.autoResolve
                ),
                // Templates describe a condition, not a firing policy; a rule
                // made from one repeats until the operator says otherwise.
                triggerOnce: false,
                config: normalizeAlertRuleConfig(template.kind, mergedConfig),
                groupBy: null,
                deliveryMode: 'instant',
                digestWindowMinutes: null,
                activeWindow: template.activeWindow,
                runbookUrl: null,
                templateId: null
            });
        } catch (err: unknown) {
            throw translateAlertRuleError(err, 'create');
        }
    }

    async #requireTemplate(
        templateKey: string,
        organizationId: string
    ): Promise<AlertRuleTemplate> {
        const result = await postgres.callMethod(
            'notifications.fn_alert_rule_template_get',
            {p_template_key: templateKey, p_organization_id: organizationId}
        );
        const row = result?.rows?.[0] as AlertRuleTemplateRow | undefined;
        if (!row) throw RpcError.NotFound('alert_rule_template', templateKey);
        return rowToAlertRuleTemplate(row);
    }

    async #requireTemplateKind(
        organizationId: string,
        templateId: number
    ): Promise<AlertRuleKind> {
        const rows = await postgres.queryRows<{kind: StoredAlertRuleKind}>(
            `SELECT kind
               FROM notifications.alert_rule_templates
              WHERE organization_id = $1 AND id = $2
              LIMIT 1`,
            [organizationId, templateId]
        );
        if (!rows[0]) {
            throw RpcError.NotFound('alert_rule_template', templateId);
        }
        return publicAlertRuleKind(rows[0].kind);
    }

    @Component.NoAudit
    @Component.Expose('Instance.List')
    @Component.CrudPermission('alerts', 'read')
    async listInstances(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AlertInstanceListParams>(
            params,
            ALERT_INSTANCE_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const {p_organization_id, ...filters} = await alertListFilterParams(
            organizationId,
            p
        );
        const page = alertListPageRequest(p, alertListFilterMark(filters));

        try {
            const result = await postgres.callMethod(
                'notifications.fn_alert_instance_list',
                {
                    p_organization_id,
                    ...filters,
                    p_limit: page.fetchLimit,
                    p_offset: page.offset,
                    p_after_triggered_at: page.after?.triggeredAt ?? null,
                    p_after_id: page.after?.id ?? null,
                    p_skip_total: page.after !== null,
                    ...reachParams(await alertReach(sender))
                }
            );
            const rows = (result?.rows ?? []) as AlertInstanceListRow[];
            await hydratePublicAlertSubjects(
                organizationId,
                rows as AlertInstanceRow[]
            );
            return alertListPage(rows, page);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.List', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('Instance.GetMany')
    @Component.CrudPermission('alerts', 'read')
    async getInstances(
        params: unknown,
        sender: CommandSender
    ): Promise<AlertInstanceGetManyResult> {
        const p = validateOrThrow<{organizationId?: string; ids: number[]}>(
            params,
            ALERT_INSTANCE_GET_MANY_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const asked = [...new Set(p.ids)];

        try {
            const rows = await this.#instanceRowsInReach(
                sender,
                organizationId,
                asked
            );
            await hydratePublicAlertSubjects(organizationId, rows);
            const found = new Set(rows.map((row) => row.id));
            return {
                items: rows.map(rowToAlertInstance),
                missingIds: asked.filter((id) => !found.has(id))
            };
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.GetMany', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('Instance.Get')
    @Component.CrudPermission('alerts', 'read', NOT_A_RULE_ID)
    async getInstance(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_INSTANCE_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);

        try {
            return rowToAlertInstance(
                await this.#requireInstanceRowInReach(
                    sender,
                    organizationId,
                    p.id,
                    await alertReach(sender)
                )
            );
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.Get', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('Instance.ListTransitions')
    @Component.CrudPermission('alerts', 'read', NOT_A_RULE_ID)
    async listInstanceTransitions(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
        }>(params, ALERT_INSTANCE_LIST_TRANSITIONS_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        try {
            await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.id,
                await alertReach(sender)
            );

            const result = await postgres.callMethod(
                'notifications.fn_alert_instance_list_transitions',
                {
                    p_alert_id: p.id,
                    p_limit: limit,
                    p_offset: offset
                }
            );
            const rows = (result?.rows ?? []) as AlertTransitionListRow[];
            const total =
                rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
            const items: AlertTransition[] = [];

            for (const row of rows) {
                if (!row.created_at || !row.action) continue;
                items.push(rowToAlertTransition(row as AlertTransitionRow));
            }

            return buildListResponse(items, total, limit, offset);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.ListTransitions', err);
        }
    }

    @Component.Expose('Instance.Ack')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async ackInstance(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            comment?: string;
        }>(params, ALERT_INSTANCE_ACK_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        const ackComment = normalizeOptionalText(p.comment);

        try {
            const current = await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.id,
                await alertWriteReach(sender)
            );
            if (isResolvedAlert(current)) throwResolvedAlertConflict(p.id);
            // Already-acked: refresh the comment only if the caller passed
            // a new one; the no-op happy path stays a no-op.
            if (current.state === 'acknowledged' && ackComment === null) {
                return rowToAlertInstance(current);
            }

            const row = await this.#applyInstanceAction(
                organizationId,
                p.id,
                'acknowledged',
                actor,
                {ackComment}
            );
            this.#auditInstanceTransition('ack', sender, row ?? current);
            // Cancel any scheduled motion auto-resolve — user has ownership now.
            if (current.rule_kind === 'motion_detected') {
                void OutboxWorker.cancelMotionClear(
                    current.rule_id,
                    current.fingerprint
                );
            }
            if (row) emitAlertInstanceEvent('Alert.Updated', row);
            return rowToAlertInstance(row ?? current);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.Ack', err);
        }
    }

    @Component.Expose('Instance.Unack')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async unackInstance(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_INSTANCE_UNACK_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);

        try {
            const current = await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.id,
                await alertWriteReach(sender)
            );
            if (isResolvedAlert(current)) throwResolvedAlertConflict(p.id);
            if (current.state === 'active') {
                return rowToAlertInstance(current);
            }

            const row = await this.#applyInstanceAction(
                organizationId,
                p.id,
                'unacknowledged',
                actor
            );
            this.#auditInstanceTransition('unack', sender, row ?? current);
            if (row) emitAlertInstanceEvent('Alert.Updated', row);
            return rowToAlertInstance(row ?? current);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.Unack', err);
        }
    }

    @Component.Expose('Instance.Silence')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async silenceInstance(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            until: string;
            reason?: string | null;
        }>(params, ALERT_INSTANCE_SILENCE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        const until = parseFutureTimestamp(p.until, 'until');

        try {
            const current = await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.id,
                await alertWriteReach(sender)
            );
            if (isResolvedAlert(current)) throwResolvedAlertConflict(p.id);

            const row = await this.#applyInstanceAction(
                organizationId,
                p.id,
                'silenced',
                actor,
                {
                    silencedUntil: until,
                    silenceReason: normalizeOptionalText(p.reason),
                    transitionData: {
                        until,
                        reason: normalizeOptionalText(p.reason)
                    }
                }
            );
            this.#auditInstanceTransition('silence', sender, row ?? current, {
                silencedUntil: until,
                silenceReason: normalizeOptionalText(p.reason)
            });
            if (row) emitAlertInstanceEvent('Alert.Updated', row);
            return rowToAlertInstance(row ?? current);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.Silence', err);
        }
    }

    @Component.Expose('Instance.Unsilence')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async unsilenceInstance(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_INSTANCE_UNSILENCE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);

        try {
            const current = await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.id,
                await alertWriteReach(sender)
            );
            if (isResolvedAlert(current)) throwResolvedAlertConflict(p.id);
            if (
                current.silenced_until == null &&
                current.silence_reason == null
            ) {
                return rowToAlertInstance(current);
            }

            const row = await this.#applyInstanceAction(
                organizationId,
                p.id,
                'unsilenced',
                actor
            );
            this.#auditInstanceTransition('unsilence', sender, row ?? current);
            if (row) emitAlertInstanceEvent('Alert.Updated', row);
            return rowToAlertInstance(row ?? current);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.Unsilence', err);
        }
    }

    @Component.Expose('Instance.ResolveManual')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async resolveInstanceManual(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_INSTANCE_RESOLVE_MANUAL_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);

        try {
            const current = await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.id,
                await alertWriteReach(sender)
            );
            const closesItself =
                ALERT_RULE_KIND_DESCRIPTOR_BY_KEY[
                    publicAlertRuleKind(current.rule_kind)
                ]?.supportsManualResolve !== true;
            // "Closes itself when the sensor is back" holds only while the
            // sensor exists. A deleted one never comes back, so let it close.
            if (
                closesItself &&
                !(await alertSubjectMissing(organizationId, p.id))
            ) {
                throw RpcError.Domain('UnsupportedOperation', {
                    message: MANUAL_RESOLVE_REFUSAL,
                    details: {
                        resourceType: 'alert_instance',
                        identifier: p.id,
                        ruleKind: publicAlertRuleKind(current.rule_kind)
                    }
                });
            }
            if (isResolvedAlert(current)) {
                return rowToAlertInstance(current);
            }

            const row = await this.#applyInstanceAction(
                organizationId,
                p.id,
                'resolved',
                actor,
                {transitionData: {mode: 'manual'}}
            );
            this.#auditInstanceTransition(
                'resolve_manual',
                sender,
                row ?? current
            );
            if (row) emitAlertInstanceEvent('Alert.Resolved', row);
            return rowToAlertInstance(row ?? current);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.ResolveManual', err);
        }
    }

    @Component.Expose('Instance.Annotate')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async annotateInstance(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            alertInstanceId: number;
            body: string;
        }>(params, ALERT_ANNOTATION_APPEND_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        const body = p.body.trim();
        if (!body) {
            throw RpcError.InvalidParams('annotation body cannot be empty');
        }
        try {
            await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.alertInstanceId,
                await alertWriteReach(sender)
            );
            const result = await postgres.callMethod(
                'notifications.fn_alert_annotation_append',
                {
                    p_organization_id: organizationId,
                    p_alert_instance_id: p.alertInstanceId,
                    p_author_user_id: actor.userId,
                    p_author_display_name: actor.displayName,
                    p_body: body
                }
            );
            const row = result?.rows?.[0] as AnnotationRow | undefined;
            if (!row)
                throw RpcError.NotFound('alert_instance', p.alertInstanceId);
            return rowToAlertAnnotation(row);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.Annotate', err);
        }
    }

    @Component.Expose('Instance.ListAnnotations')
    @Component.CrudPermission('alerts', 'read', NOT_A_RULE_ID)
    async listInstanceAnnotations(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            alertInstanceId: number;
        }>(params, ALERT_ANNOTATION_LIST_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        try {
            await this.#requireInstanceRowInReach(
                sender,
                organizationId,
                p.alertInstanceId,
                await alertReach(sender)
            );
            const result = await postgres.callMethod(
                'notifications.fn_alert_annotation_list',
                {
                    p_organization_id: organizationId,
                    p_alert_instance_id: p.alertInstanceId
                }
            );
            const rows = (result?.rows ?? []) as AnnotationRow[];
            return {items: rows.map(rowToAlertAnnotation)};
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.ListAnnotations', err);
        }
    }

    @Component.Expose('Instance.EditAnnotation')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async editInstanceAnnotation(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            body: string;
        }>(params, ALERT_ANNOTATION_EDIT_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        const body = p.body.trim();
        if (!body) {
            throw RpcError.InvalidParams('annotation body cannot be empty');
        }
        try {
            await this.#requireAnnotationInWriteReach(
                sender,
                organizationId,
                p.id
            );
            const result = await postgres.callMethod(
                'notifications.fn_alert_annotation_edit',
                {
                    p_organization_id: organizationId,
                    p_id: p.id,
                    p_author_user_id: actor.userId,
                    p_body: body
                }
            );
            const row = result?.rows?.[0] as AnnotationRow | undefined;
            // Author-only: missing row means either no such row OR caller
            // isn't the author. Don't leak which.
            if (!row) {
                throw RpcError.Domain('PermissionDenied', {
                    message:
                        'only the original author may edit this annotation',
                    details: {
                        resourceType: 'alert_annotation',
                        identifier: p.id
                    }
                });
            }
            return rowToAlertAnnotation(row);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.EditAnnotation', err);
        }
    }

    @Component.Expose('Instance.DeleteAnnotation')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async deleteInstanceAnnotation(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_ANNOTATION_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        try {
            await this.#requireAnnotationInWriteReach(
                sender,
                organizationId,
                p.id
            );
            const result = await postgres.callMethod(
                'notifications.fn_alert_annotation_delete',
                {
                    p_organization_id: organizationId,
                    p_id: p.id,
                    p_author_user_id: actor.userId
                }
            );
            const deleted = Boolean(
                (result?.rows?.[0] as {fn_alert_annotation_delete?: boolean})
                    ?.fn_alert_annotation_delete
            );
            return {deleted};
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Instance.DeleteAnnotation', err);
        }
    }

    @Component.Expose('Rule.Template.Create')
    @Component.CrudPermission('alerts', 'create')
    async createRuleTemplate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            templateKey: string;
            category: string;
            label: string;
            description?: string | null;
            kind: AlertRuleKind;
            severity: AlertSeverity;
            scope?: ScopeSelector;
            config?: JsonRecord;
            dedupeWindowSec?: number;
            cooldownSec?: number;
            summaryTemplate?: string | null;
            messageTemplate?: string | null;
            autoResolve?: boolean;
            activeWindow?: AlertActiveWindow | null;
            available?: boolean;
            unavailableReason?: string | null;
        }>(params, ALERT_RULE_TEMPLATE_CREATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        try {
            const availability = normalizeTemplateAvailability({
                available: p.available ?? true,
                unavailableReason: p.unavailableReason ?? null
            });
            const scope = validateSupportedScopeSelector(p.kind, p.scope ?? {});
            const result = await postgres.callMethod(
                'notifications.fn_alert_rule_template_create',
                {
                    p_organization_id: organizationId,
                    p_template_key: p.templateKey,
                    p_category: p.category,
                    p_label: normalizeName(p.label, 'Template label'),
                    p_description: normalizeOptionalText(p.description),
                    p_kind: p.kind,
                    p_severity: p.severity,
                    p_scope: scope,
                    p_config: normalizeAlertRuleConfig(p.kind, p.config),
                    p_dedupe_window_sec: p.dedupeWindowSec ?? 0,
                    p_cooldown_sec: p.cooldownSec ?? 0,
                    p_summary_template: normalizeOptionalText(
                        p.summaryTemplate
                    ),
                    p_message_template: normalizeOptionalText(
                        p.messageTemplate
                    ),
                    p_auto_resolve: resolveAlertRuleAutoResolve(
                        p.kind,
                        p.autoResolve
                    ),
                    p_active_window: readActiveWindow(p.activeWindow),
                    p_available: availability.available,
                    p_unavailable_reason: availability.unavailableReason,
                    p_author_user_id: actor.userId
                }
            );
            const row = result?.rows?.[0] as AlertRuleTemplateRow | undefined;
            if (!row)
                throw RpcError.OperationFailed('Alert.Rule.Template.Create');
            return rowToAlertRuleTemplate(row);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Rule.Template.Create', err);
        }
    }

    @Component.Expose('Rule.Template.Update')
    @Component.CrudPermission('alerts', 'update', NOT_A_RULE_ID)
    async updateRuleTemplate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            label?: string;
            description?: string | null;
            severity?: AlertSeverity;
            scope?: ScopeSelector;
            config?: JsonRecord;
            dedupeWindowSec?: number;
            cooldownSec?: number;
            summaryTemplate?: string | null;
            messageTemplate?: string | null;
            autoResolve?: boolean;
            activeWindow?: AlertActiveWindow | null;
            available?: boolean;
            unavailableReason?: string | null;
        }>(params, ALERT_RULE_TEMPLATE_UPDATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        try {
            await requireOrgWideAlertGrant(sender, 'update');
            const availability = normalizeTemplateAvailabilityPatch(p);
            const scope =
                p.scope === undefined
                    ? null
                    : validateSupportedScopeSelector(
                          await this.#requireTemplateKind(organizationId, p.id),
                          p.scope
                      );
            const result = await postgres.callMethod(
                'notifications.fn_alert_rule_template_update',
                {
                    p_organization_id: organizationId,
                    p_id: p.id,
                    p_author_user_id: actor.userId,
                    p_label:
                        p.label !== undefined
                            ? normalizeName(p.label, 'Template label')
                            : null,
                    p_description:
                        p.description !== undefined
                            ? normalizeOptionalText(p.description)
                            : null,
                    p_severity: p.severity ?? null,
                    p_scope: scope,
                    p_config: p.config ?? null,
                    p_dedupe_window_sec: p.dedupeWindowSec ?? null,
                    p_cooldown_sec: p.cooldownSec ?? null,
                    p_summary_template:
                        p.summaryTemplate !== undefined
                            ? normalizeOptionalText(p.summaryTemplate)
                            : null,
                    p_message_template:
                        p.messageTemplate !== undefined
                            ? normalizeOptionalText(p.messageTemplate)
                            : null,
                    p_auto_resolve: p.autoResolve ?? null,
                    p_active_window:
                        p.activeWindow === undefined
                            ? null
                            : readActiveWindow(p.activeWindow),
                    p_clear_active_window: p.activeWindow === null,
                    p_available: availability.available,
                    p_unavailable_reason: availability.unavailableReason,
                    p_clear_unavailable_reason:
                        availability.clearUnavailableReason
                }
            );
            const row = result?.rows?.[0] as AlertRuleTemplateRow | undefined;
            if (!row) {
                throw RpcError.Domain('PermissionDenied', {
                    message: 'only the original author may edit this template',
                    details: {
                        resourceType: 'alert_rule_template',
                        identifier: p.id
                    }
                });
            }
            return rowToAlertRuleTemplate(row);
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Rule.Template.Update', err);
        }
    }

    @Component.Expose('Rule.Template.Delete')
    @Component.CrudPermission('alerts', 'delete', NOT_A_RULE_ID)
    async deleteRuleTemplate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            ALERT_RULE_TEMPLATE_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const actor = requireActionActor(sender);
        try {
            await requireOrgWideAlertGrant(sender, 'delete');
            const result = await postgres.callMethod(
                'notifications.fn_alert_rule_template_delete',
                {
                    p_organization_id: organizationId,
                    p_id: p.id,
                    p_author_user_id: actor.userId
                }
            );
            const deleted = Boolean(
                (result?.rows?.[0] as {fn_alert_rule_template_delete?: boolean})
                    ?.fn_alert_rule_template_delete
            );
            return {deleted};
        } catch (err: unknown) {
            throw asOperationFailed('Alert.Rule.Template.Delete', err);
        }
    }
}

interface AnnotationRow {
    id: number | string;
    alert_instance_id: number;
    organization_id: string;
    author_user_id: string;
    author_display_name: string | null;
    body: string;
    created_at: Date | string;
    edited_at: Date | string | null;
}

function rowToAlertAnnotation(row: AnnotationRow): AlertAnnotation {
    return {
        id: Number(row.id),
        alertInstanceId: row.alert_instance_id,
        organizationId: row.organization_id,
        author: {
            userId: row.author_user_id,
            displayName: row.author_display_name
        },
        body: row.body,
        createdAt: toIso(row.created_at) ?? '',
        editedAt: toIso(row.edited_at)
    };
}
