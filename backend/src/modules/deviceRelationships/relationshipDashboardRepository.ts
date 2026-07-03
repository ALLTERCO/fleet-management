import type {
    DeviceRelationshipInclude,
    RelationshipSummaryDto
} from '../../types/api/device';
import * as postgres from '../PostgresProvider';
import {isComponentKey} from './componentKeys';
import type {
    DeviceRelationshipPermissions,
    RelationshipDashboardItemFact
} from './types';

export interface RelationshipDashboardCache {
    dashboardItemRows?: Promise<DashboardItemRow[]>;
}

interface RelationshipDashboardInput {
    organizationId: string | undefined;
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    permissions: Pick<
        DeviceRelationshipPermissions,
        'actionsRead' | 'dashboardsRead'
    >;
    cache?: RelationshipDashboardCache;
}

interface OrganizationRelationshipDashboardInput
    extends RelationshipDashboardInput {
    organizationId: string;
}

interface DashboardItemRow {
    dashboard_id: number;
    dashboard_name: string;
    item_id: number;
    kind: RelationshipDashboardItemFact['itemKind'];
    target_external_id: string | null;
    entity_sub_id: string | null;
    group_id: number | null;
    location_id: number | null;
    tag_id: number | null;
    action_id: number | null;
    action_name: string | null;
    target_missing: boolean;
}

export async function loadIncludedDashboardItemFacts(
    input: RelationshipDashboardInput
): Promise<RelationshipDashboardItemFact[]> {
    if (!canReadDashboardRelationships(input)) return [];
    const rows = await loadDashboardItemRows(requireOrganization(input));
    return rows.map((row) =>
        dashboardItemFact({
            row,
            canReadActionLabels: input.permissions.actionsRead
        })
    );
}

export async function loadDashboardRelationshipSummaries(
    input: RelationshipDashboardInput
): Promise<RelationshipSummaryDto[]> {
    if (!canReadDashboardRelationships(input)) return [];
    const rows = await loadDashboardItemRows(requireOrganization(input));
    return rows
        .filter(dashboardItemHasMissingTarget)
        .map(dashboardItemMissingTargetSummary);
}

function canReadDashboardRelationships(
    input: RelationshipDashboardInput
): boolean {
    return (
        input.includes.has('dashboards') &&
        Boolean(input.organizationId) &&
        input.permissions.dashboardsRead
    );
}

async function loadDashboardItemRows(
    input: OrganizationRelationshipDashboardInput
): Promise<DashboardItemRow[]> {
    if (!input.cache) return await queryDirectDashboardItems(input);
    input.cache.dashboardItemRows ??= queryDirectDashboardItems(input);
    return await input.cache.dashboardItemRows;
}

async function queryDirectDashboardItems(
    input: OrganizationRelationshipDashboardInput
): Promise<DashboardItemRow[]> {
    return await postgres.queryRows<DashboardItemRow>(
        `SELECT
            d.id AS dashboard_id,
            d.name AS dashboard_name,
            di.id AS item_id,
            di.kind,
            target.external_id AS target_external_id,
            di.entity_sub_id,
            di.group_id,
            di.location_id,
            di.tag_id,
            di.action_id,
            action.name AS action_name,
            (di.device_id IS NOT NULL AND target.id IS NULL) AS target_missing
           FROM ui.dashboard_item di
           JOIN ui.dashboard d
             ON d.id = di.dashboard
            AND d.organization_id = $1
      LEFT JOIN device.list target
             ON target.id = di.device_id
            AND target.organization_id = d.organization_id
      LEFT JOIN ui.dashboard_item_action action
             ON $3::boolean
            AND action.id = di.action_id
            AND action.organization_id = d.organization_id
          WHERE target.external_id = $2
             OR (
                 di.group_id IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                       FROM organization.group_members gm
                      WHERE gm.organization_id = d.organization_id
                        AND gm.subject_type = 'device'
                        AND gm.subject_id = $2
                        AND gm.group_id = di.group_id
                 )
             )
             OR (
                 di.location_id IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                       FROM organization.location_assignments la
                      WHERE la.organization_id = d.organization_id
                        AND la.subject_type = 'device'
                        AND la.subject_id = $2
                        AND la.location_id = di.location_id
                 )
             )
             OR (
                 di.tag_id IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                       FROM organization.tag_assignments ta
                      WHERE ta.organization_id = d.organization_id
                        AND ta.subject_type = 'device'
                        AND ta.subject_id = $2
                        AND ta.tag_id = di.tag_id
                 )
             )
          ORDER BY d.name ASC, di."order" ASC, di.id ASC
          LIMIT 200`,
        [
            input.organizationId,
            input.centerExternalId,
            input.permissions.actionsRead
        ]
    );
}

function dashboardItemFact(input: {
    row: DashboardItemRow;
    canReadActionLabels: boolean;
}): RelationshipDashboardItemFact {
    return {
        dashboardId: input.row.dashboard_id,
        dashboardLabel: input.row.dashboard_name,
        itemId: input.row.item_id,
        itemKind: input.row.kind,
        itemLabel: `${input.row.kind} item ${input.row.item_id}`,
        targetExternalId: input.row.target_external_id ?? undefined,
        targetEntityId: dashboardTargetEntityId(input.row.entity_sub_id),
        targetComponentKey: dashboardTargetComponentKey(
            input.row.entity_sub_id
        ),
        targetGroupId: input.row.group_id ?? undefined,
        targetLocationId: input.row.location_id ?? undefined,
        targetTagId: input.row.tag_id ?? undefined,
        actionId: input.row.action_id ?? undefined,
        actionLabel: dashboardActionLabel(input)
    };
}

function dashboardTargetComponentKey(value: string | null): string | undefined {
    return isComponentKey(value) ? value : undefined;
}

function dashboardTargetEntityId(value: string | null): string | undefined {
    return isComponentKey(value) ? undefined : (value ?? undefined);
}

function dashboardActionLabel(input: {
    row: DashboardItemRow;
    canReadActionLabels: boolean;
}): string | undefined {
    if (!input.canReadActionLabels) return undefined;
    return input.row.action_name ?? undefined;
}

function dashboardItemHasMissingTarget(row: DashboardItemRow): boolean {
    return (
        row.target_missing ||
        (row.entity_sub_id !== null && row.target_external_id === null)
    );
}

function dashboardItemMissingTargetSummary(
    row: DashboardItemRow
): RelationshipSummaryDto {
    return {
        severity: 'warning',
        text: `Dashboard item ${row.item_id} on ${row.dashboard_name} has a missing device or entity target.`,
        nodeIds: [`dashboard_item:${row.dashboard_id}:${row.item_id}`],
        reasonCode: 'dashboard_item_target_missing'
    };
}

function requireOrganization(
    input: RelationshipDashboardInput
): OrganizationRelationshipDashboardInput {
    if (!input.organizationId) {
        throw new Error('organizationId is required');
    }
    return {...input, organizationId: input.organizationId};
}
