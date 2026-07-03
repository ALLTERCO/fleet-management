import {toIso} from '../../rpc/pgRows';
import type {RelationshipSummaryDto} from '../../types/api/device';
import {readContactPointIds} from '../notification/contactPoints';
import {resourceSelectorsMatch} from '../notification/matchers';
import * as postgres from '../PostgresProvider';
import {queryDirectAlertRules} from './alertFacts';
import {
    centerEntityIds,
    loadCenterMemberships,
    locationScopeIds,
    readArray,
    readScopeIds,
    requireOrganization,
    uniqueNumbers
} from './relationshipShared';
import type {
    AlertDestinationRow,
    DestinationGroupRow,
    DeviceMemberships,
    MaintenanceWindowRow,
    NotificationChannelRow,
    NotificationRoutingFacts,
    OnCallScheduleRow,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput,
    RoutingPolicyRow
} from './relationshipTypes';
import type {
    RelationshipAlertDestinationFact,
    RelationshipDestinationGroupFact,
    RelationshipMaintenanceWindowFact,
    RelationshipNotificationChannelFact,
    RelationshipOnCallScheduleFact,
    RelationshipRoutingPolicyFact
} from './types';

export async function loadIncludedNotificationRoutingFacts(
    input: RelationshipLoadInput
): Promise<NotificationRoutingFacts> {
    if (
        !input.includes.has('notificationRouting') ||
        !input.organizationId ||
        !input.permissions.notificationsRead
    ) {
        return emptyNotificationRoutingFacts();
    }
    return await loadNotificationRoutingFacts(requireOrganization(input));
}

async function loadNotificationRoutingFacts(
    input: OrganizationRelationshipLoadInput
): Promise<NotificationRoutingFacts> {
    const memberships = await loadCenterMemberships(input);
    const [maintenanceWindows, routingPolicies, alertDestinations] =
        await Promise.all([
            loadMaintenanceWindowFacts({input, memberships}),
            loadRoutingPolicyFacts(input),
            loadAlertDestinationFacts(input)
        ]);
    const destinationGroups = await loadDestinationGroupFacts({
        organizationId: input.organizationId,
        ids: [
            ...alertDestinations.map((fact) => fact.destinationGroupId),
            ...routingPolicies.flatMap((fact) => fact.destinationGroupIds)
        ]
    });
    const notificationChannelIds = [
        ...routingPolicies.flatMap((fact) => fact.channelIds),
        ...destinationGroups.flatMap((fact) => fact.endpointIds)
    ];
    const notificationChannels = await loadNotificationChannelFacts({
        organizationId: input.organizationId,
        ids: notificationChannelIds
    });
    const onCallSchedules = await loadOnCallScheduleFacts({
        organizationId: input.organizationId,
        ids: routingPolicies.flatMap((fact) => fact.onCallScheduleIds)
    });
    return {
        alertDestinations,
        maintenanceWindows,
        routingPolicies,
        destinationGroups,
        notificationChannels,
        onCallSchedules,
        summaries: maintenanceWindowSummaries(maintenanceWindows)
    };
}

async function loadMaintenanceWindowFacts(input: {
    input: OrganizationRelationshipLoadInput;
    memberships: DeviceMemberships;
}): Promise<RelationshipMaintenanceWindowFact[]> {
    const rows = await queryMaintenanceWindows(input);
    return rows.map((row) =>
        maintenanceWindowFact({
            centerExternalId: input.input.centerExternalId,
            memberships: input.memberships,
            row
        })
    );
}

async function queryMaintenanceWindows(input: {
    input: OrganizationRelationshipLoadInput;
    memberships: DeviceMemberships;
}): Promise<MaintenanceWindowRow[]> {
    return await postgres.queryRows<MaintenanceWindowRow>(
        `SELECT
            id,
            scope_type,
            scope_ids,
            starts_at,
            ends_at,
            recurrence_rule,
            reason
           FROM notifications.maintenance_windows
          WHERE organization_id = $1
            AND (
                scope_type = 'org'
                OR (
                    scope_type = 'device'
                    AND jsonb_typeof(scope_ids) = 'array'
                    AND EXISTS (
                        SELECT 1
                          FROM jsonb_array_elements_text(scope_ids) AS scope_id(value)
                         WHERE scope_id.value = ANY(ARRAY[$2]::text[])
                    )
                )
                OR (
                    scope_type = 'device_group'
                    AND jsonb_typeof(scope_ids) = 'array'
                    AND EXISTS (
                        SELECT 1
                          FROM jsonb_array_elements_text(scope_ids) AS scope_id(value)
                         WHERE scope_id.value = ANY($3::text[])
                    )
                )
                OR (
                    scope_type = 'location'
                    AND jsonb_typeof(scope_ids) = 'array'
                    AND EXISTS (
                        SELECT 1
                          FROM jsonb_array_elements_text(scope_ids) AS scope_id(value)
                         WHERE scope_id.value = ANY($4::text[])
                    )
                )
                OR (
                    scope_type = 'tag'
                    AND jsonb_typeof(scope_ids) = 'array'
                    AND EXISTS (
                        SELECT 1
                          FROM jsonb_array_elements_text(scope_ids) AS scope_id(value)
                         WHERE scope_id.value = ANY($5::text[])
                    )
                )
            )
          ORDER BY starts_at ASC, id ASC
          LIMIT 100`,
        [
            input.input.organizationId,
            input.input.centerExternalId,
            input.memberships.groupIds.map(String),
            locationScopeIds(input.memberships),
            input.memberships.tagIds.map(String)
        ]
    );
}

async function loadRoutingPolicyFacts(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipRoutingPolicyFact[]> {
    const rows = await queryRoutingPolicies(input);
    return rows
        .filter((row) => routingPolicyRelatesToCenter({input, row}))
        .map(routingPolicyFact)
        .filter(routingPolicyHasDestinations);
}

async function queryRoutingPolicies(
    input: OrganizationRelationshipLoadInput
): Promise<RoutingPolicyRow[]> {
    return await postgres.queryRows<RoutingPolicyRow>(
        `SELECT
            id,
            name,
            enabled,
            resource_selectors,
            contact_points
           FROM notifications.routing_policies
          WHERE organization_id = $1
            AND enabled = TRUE
          ORDER BY sort_order ASC, id ASC
          LIMIT 200`,
        [input.organizationId]
    );
}

async function loadAlertDestinationFacts(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipAlertDestinationFact[]> {
    if (!input.permissions.alertsRead) return [];
    const alertRules = await queryDirectAlertRules(input);
    const ruleIds = alertRules.map((row) => row.id);
    if (ruleIds.length === 0) return [];
    const rows = await queryAlertDestinationRows({
        organizationId: input.organizationId,
        ruleIds
    });
    return rows.map((row) => ({
        alertRuleId: row.rule_id,
        destinationGroupId: row.destination_group_id
    }));
}

async function queryAlertDestinationRows(input: {
    organizationId: string;
    ruleIds: number[];
}): Promise<AlertDestinationRow[]> {
    return await postgres.queryRows<AlertDestinationRow>(
        `SELECT rdg.rule_id, rdg.destination_group_id
           FROM notifications.alert_rule_destination_groups rdg
           JOIN notifications.alert_rules ar
             ON ar.id = rdg.rule_id
            AND ar.organization_id = $1
          WHERE rdg.rule_id = ANY($2::int[])
          ORDER BY rdg.rule_id ASC, rdg.destination_group_id ASC
          LIMIT 200`,
        [input.organizationId, input.ruleIds]
    );
}

async function loadDestinationGroupFacts(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<RelationshipDestinationGroupFact[]> {
    const groupIds = uniqueNumbers(input.ids);
    if (groupIds.length === 0) return [];
    const rows = await queryDestinationGroups({
        organizationId: input.organizationId,
        ids: groupIds
    });
    return rows.map(destinationGroupFact);
}

async function queryDestinationGroups(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<DestinationGroupRow[]> {
    return await postgres.queryRows<DestinationGroupRow>(
        `SELECT
            g.id,
            g.name,
            g.enabled,
            COALESCE(
                ARRAY_AGG(
                    CASE
                        WHEN m.member_type = 'channel'
                         AND m.member_id ~ '^[1-9][0-9]*$'
                        THEN m.member_id::int
                    END
                ) FILTER (WHERE m.member_type = 'channel'),
                ARRAY[]::int[]
            ) AS endpoint_ids
           FROM notifications.destination_groups g
      LEFT JOIN notifications.destination_group_members m
             ON m.destination_group_id = g.id
          WHERE g.organization_id = $1
            AND g.id = ANY($2::int[])
          GROUP BY g.id, g.name, g.enabled
          ORDER BY g.name ASC, g.id ASC
          LIMIT 200`,
        [input.organizationId, input.ids]
    );
}

async function loadNotificationChannelFacts(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<RelationshipNotificationChannelFact[]> {
    const channelIds = uniqueNumbers(input.ids);
    if (channelIds.length === 0) return [];
    const rows = await queryNotificationChannels({
        organizationId: input.organizationId,
        ids: channelIds
    });
    return rows.map(notificationChannelFact);
}

async function loadOnCallScheduleFacts(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<RelationshipOnCallScheduleFact[]> {
    const scheduleIds = uniqueNumbers(input.ids);
    if (scheduleIds.length === 0) return [];
    const rows = await queryOnCallSchedules({
        organizationId: input.organizationId,
        ids: scheduleIds
    });
    return rows.map(onCallScheduleFact);
}

async function queryNotificationChannels(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<NotificationChannelRow[]> {
    return await postgres.queryRows<NotificationChannelRow>(
        `SELECT
            id,
            name,
            provider,
            enabled,
            last_test_status,
            last_delivery_status
           FROM notifications.channels
          WHERE organization_id = $1
            AND id = ANY($2::bigint[])
          ORDER BY name ASC, id ASC
          LIMIT 200`,
        [input.organizationId, input.ids]
    );
}

async function queryOnCallSchedules(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<OnCallScheduleRow[]> {
    return await postgres.queryRows<OnCallScheduleRow>(
        `SELECT id, name, timezone, enabled
           FROM notifications.on_call_schedules
          WHERE organization_id = $1
            AND id = ANY($2::bigint[])
          ORDER BY name ASC, id ASC
          LIMIT 100`,
        [input.organizationId, input.ids]
    );
}

function maintenanceWindowFact(input: {
    centerExternalId: string;
    memberships: DeviceMemberships;
    row: MaintenanceWindowRow;
}): RelationshipMaintenanceWindowFact {
    const scopeIds = readScopeIds(input.row.scope_ids);
    const target = maintenanceWindowTarget({
        centerExternalId: input.centerExternalId,
        memberships: input.memberships,
        row: input.row,
        scopeIds
    });
    return {
        id: Number(input.row.id),
        label: maintenanceWindowLabel(input.row),
        scopeType: input.row.scope_type,
        scopeIds,
        startsAt: toIso(input.row.starts_at) ?? '',
        endsAt: toIso(input.row.ends_at) ?? '',
        recurrenceRule: input.row.recurrence_rule,
        reason: input.row.reason,
        targetType: target?.type,
        targetId: target?.id
    };
}

function maintenanceWindowTarget(input: {
    centerExternalId: string;
    memberships: DeviceMemberships;
    row: MaintenanceWindowRow;
    scopeIds: string[];
}): {type: 'device' | 'group' | 'location' | 'tag'; id: string} | null {
    if (input.row.scope_type === 'device') {
        return {type: 'device', id: input.centerExternalId};
    }
    if (input.row.scope_type === 'device_group') {
        return matchingScopeTarget(
            input.scopeIds,
            input.memberships.groupIds,
            'group'
        );
    }
    if (input.row.scope_type === 'location') {
        return matchingLocationTarget(input);
    }
    if (input.row.scope_type === 'tag') {
        return matchingScopeTarget(
            input.scopeIds,
            input.memberships.tagIds,
            'tag'
        );
    }
    return null;
}

function matchingScopeTarget(
    scopeIds: readonly string[],
    candidateIds: readonly number[],
    type: 'group' | 'tag'
): {type: 'group' | 'tag'; id: string} | null {
    const match = candidateIds.find((id) => scopeIds.includes(String(id)));
    return match === undefined ? null : {type, id: String(match)};
}

function matchingLocationTarget(input: {
    memberships: DeviceMemberships;
    scopeIds: string[];
}): {type: 'location'; id: string} | null {
    const locationId = input.memberships.locationId;
    if (locationId === null) return null;
    if (!input.scopeIds.includes(String(locationId))) return null;
    return {type: 'location', id: String(locationId)};
}

function maintenanceWindowLabel(row: MaintenanceWindowRow): string {
    return row.reason?.trim() || `Maintenance window ${row.id}`;
}

function maintenanceWindowSummaries(
    facts: readonly RelationshipMaintenanceWindowFact[]
): RelationshipSummaryDto[] {
    return facts
        .filter((fact) => fact.scopeType === 'org')
        .map((fact) => ({
            severity: 'info',
            text: `Organization maintenance window applies: ${fact.label}`,
            reasonCode: 'organization_maintenance_window'
        }));
}

function routingPolicyRelatesToCenter(input: {
    input: RelationshipLoadInput;
    row: RoutingPolicyRow;
}): boolean {
    const selectors = readArray(input.row.resource_selectors);
    if (resourceSelectorsMatch(selectors, centerDeviceResource(input.input))) {
        return true;
    }
    return centerEntityIds(input.input).some((entityId) =>
        resourceSelectorsMatch(selectors, {type: 'entity', id: entityId})
    );
}

function centerDeviceResource(input: RelationshipLoadInput): {
    type: string;
    id: string;
} {
    return {type: 'device', id: input.centerExternalId};
}

function routingPolicyFact(
    row: RoutingPolicyRow
): RelationshipRoutingPolicyFact {
    const contactPoints = readArray(row.contact_points);
    return {
        id: Number(row.id),
        label: row.name,
        enabled: row.enabled,
        destinationGroupIds: uniqueNumbers(
            readContactPointIds(contactPoints, 'destination_group')
        ),
        channelIds: uniqueNumbers(
            readContactPointIds(contactPoints, 'channel')
        ),
        onCallScheduleIds: uniqueNumbers(
            readContactPointIds(contactPoints, 'on_call_schedule')
        )
    };
}

function routingPolicyHasDestinations(
    fact: RelationshipRoutingPolicyFact
): boolean {
    return (
        fact.destinationGroupIds.length > 0 ||
        fact.channelIds.length > 0 ||
        fact.onCallScheduleIds.length > 0
    );
}

function destinationGroupFact(
    row: DestinationGroupRow
): RelationshipDestinationGroupFact {
    return {
        id: Number(row.id),
        label: row.name,
        enabled: row.enabled,
        endpointIds: uniqueNumbers(row.endpoint_ids ?? [])
    };
}

function notificationChannelFact(
    row: NotificationChannelRow
): RelationshipNotificationChannelFact {
    return {
        id: Number(row.id),
        label: row.name,
        provider: row.provider,
        status: notificationChannelStatus(row),
        meta: {
            lastTestStatus: row.last_test_status,
            lastDeliveryStatus: row.last_delivery_status
        }
    };
}

function onCallScheduleFact(
    row: OnCallScheduleRow
): RelationshipOnCallScheduleFact {
    return {
        id: Number(row.id),
        label: row.name,
        enabled: row.enabled,
        timezone: row.timezone
    };
}

function notificationChannelStatus(
    row: NotificationChannelRow
): RelationshipNotificationChannelFact['status'] {
    if (!row.enabled) return 'disabled';
    if (row.last_delivery_status === 'failed') return 'warning';
    if (row.last_test_status === 'failed') return 'warning';
    if (row.last_delivery_status === 'success') return 'healthy';
    if (row.last_test_status === 'success') return 'healthy';
    return 'unknown';
}

function emptyNotificationRoutingFacts(): NotificationRoutingFacts {
    return {
        alertDestinations: [],
        maintenanceWindows: [],
        routingPolicies: [],
        destinationGroups: [],
        notificationChannels: [],
        onCallSchedules: [],
        summaries: []
    };
}
