import * as postgres from '../PostgresProvider';
import {
    finiteNumber,
    loadCenterMemberships,
    nullableString,
    objectRecord,
    optionalString,
    requireOrganization,
    uniqueMembershipIds
} from './relationshipShared';
import type {
    DeviceMemberships,
    GroupMembershipRow,
    LocationMembershipRow,
    MembershipDetails,
    MembershipFactInput,
    MembershipGraphFacts,
    MembershipTargetDetails,
    RelationshipLoadInput,
    TagMembershipRow
} from './relationshipTypes';
import type {
    RelationshipMembershipFact,
    RelationshipMembershipHierarchyFact,
    RelationshipReadableResources
} from './types';

export async function loadIncludedMembershipGraphFacts(
    input: RelationshipLoadInput
): Promise<MembershipGraphFacts> {
    if (!input.includes.has('membership') || !input.organizationId) {
        return emptyMembershipGraphFacts();
    }
    const scopedInput = requireOrganization(input);
    const memberships = filterMembershipsByReadableResources({
        memberships: await loadCenterMemberships(scopedInput),
        readableResources: input.readableResources
    });
    const details = await loadMembershipDetails({
        organizationId: scopedInput.organizationId,
        readableResources: input.readableResources,
        memberships
    });
    return {
        memberships: membershipFactsFromRows({
            centerExternalId: input.centerExternalId,
            memberships,
            details
        }),
        hierarchies: membershipHierarchyFacts(details)
    };
}

function emptyMembershipGraphFacts(): MembershipGraphFacts {
    return {memberships: [], hierarchies: []};
}

function filterMembershipsByReadableResources(input: {
    memberships: DeviceMemberships;
    readableResources: RelationshipReadableResources | undefined;
}): DeviceMemberships {
    return {
        groupIds: readableMembershipIds({
            ids: input.memberships.groupIds,
            allowedIds: input.readableResources?.groups
        }),
        locationId: readableLocationId({
            id: input.memberships.locationId,
            allowedIds: input.readableResources?.locations
        }),
        tagIds: readableMembershipIds({
            ids: input.memberships.tagIds,
            allowedIds: input.readableResources?.tags
        })
    };
}

function readableMembershipIds(input: {
    ids: readonly number[];
    allowedIds: readonly number[] | null | undefined;
}): number[] {
    if (input.allowedIds === undefined || input.allowedIds === null) {
        return [...input.ids];
    }
    const allowed = new Set(input.allowedIds);
    return input.ids.filter((id) => allowed.has(id));
}

function readableLocationId(input: {
    id: number | null;
    allowedIds: readonly number[] | null | undefined;
}): number | null {
    if (input.id === null) return null;
    if (input.allowedIds === undefined || input.allowedIds === null) {
        return input.id;
    }
    return input.allowedIds.includes(input.id) ? input.id : null;
}

export function readableResourceId(input: {
    id: string;
    allowedIds: readonly number[] | null | undefined;
}): boolean {
    if (input.allowedIds === undefined || input.allowedIds === null) {
        return true;
    }
    if (!/^[1-9]\d*$/.test(input.id)) return false;
    return input.allowedIds.includes(Number(input.id));
}

export function filterMembershipDetails(input: {
    details: MembershipDetails;
    readableResources: RelationshipReadableResources | undefined;
}): MembershipDetails {
    return {
        groups: readableDetails({
            details: input.details.groups,
            allowedIds: input.readableResources?.groups
        }),
        locations: readableDetails({
            details: input.details.locations,
            allowedIds: input.readableResources?.locations
        }),
        tags: readableDetails({
            details: input.details.tags,
            allowedIds: input.readableResources?.tags
        })
    };
}

function readableDetails(input: {
    details: Map<number, MembershipTargetDetails>;
    allowedIds: readonly number[] | null | undefined;
}): Map<number, MembershipTargetDetails> {
    if (input.allowedIds === undefined || input.allowedIds === null) {
        return input.details;
    }
    const allowed = new Set(input.allowedIds);
    return new Map([...input.details].filter(([id]) => allowed.has(id)));
}

function membershipFactsFromRows(input: {
    centerExternalId: string;
    memberships: DeviceMemberships;
    details: MembershipDetails;
}): RelationshipMembershipFact[] {
    return [
        ...input.memberships.groupIds.map((id) =>
            membershipFact({
                deviceExternalId: input.centerExternalId,
                targetType: 'group',
                id,
                details: input.details
            })
        ),
        ...locationMembershipFacts(input),
        ...input.memberships.tagIds.map((id) =>
            membershipFact({
                deviceExternalId: input.centerExternalId,
                targetType: 'tag',
                id,
                details: input.details
            })
        )
    ];
}

function locationMembershipFacts(input: {
    centerExternalId: string;
    memberships: DeviceMemberships;
    details: MembershipDetails;
}): RelationshipMembershipFact[] {
    if (input.memberships.locationId === null) return [];
    return [
        membershipFact({
            deviceExternalId: input.centerExternalId,
            targetType: 'location',
            id: input.memberships.locationId,
            details: input.details
        })
    ];
}

async function loadMembershipDetails(input: {
    organizationId: string;
    readableResources: RelationshipReadableResources | undefined;
    memberships: DeviceMemberships;
}): Promise<MembershipDetails> {
    const [groups, locations, tags] = await Promise.all([
        queryGroupMembershipDetails({
            organizationId: input.organizationId,
            ids: input.memberships.groupIds
        }),
        queryLocationMembershipDetails({
            organizationId: input.organizationId,
            ids: locationIds(input.memberships)
        }),
        queryTagMembershipDetails({
            organizationId: input.organizationId,
            ids: input.memberships.tagIds
        })
    ]);
    return filterMembershipDetails({
        details: {groups, locations, tags},
        readableResources: input.readableResources
    });
}

export async function queryGroupMembershipDetails(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<Map<number, MembershipTargetDetails>> {
    const ids = uniqueMembershipIds(input.ids);
    if (ids.length === 0) return new Map();
    const rows = await postgres.queryRows<GroupMembershipRow>(
        `WITH RECURSIVE group_tree AS (
             SELECT id, name, group_type, parent_group_id, visual_json, image_asset_id
               FROM organization.groups
              WHERE organization_id = $1
                AND id = ANY($2::integer[])
             UNION
             SELECT
                 parent.id,
                 parent.name,
                 parent.group_type,
                 parent.parent_group_id,
                 parent.visual_json,
                 parent.image_asset_id
               FROM organization.groups parent
               JOIN group_tree child ON child.parent_group_id = parent.id
              WHERE parent.organization_id = $1
         )
         SELECT DISTINCT id, name, group_type, parent_group_id, visual_json, image_asset_id
           FROM group_tree`,
        [input.organizationId, ids]
    );
    return new Map(
        rows.map((row) => [
            row.id,
            {
                label: row.name,
                imageAssetId: row.image_asset_id,
                meta: groupMembershipMeta(row),
                parentId: row.parent_group_id
            }
        ])
    );
}

export async function queryLocationMembershipDetails(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<Map<number, MembershipTargetDetails>> {
    const ids = uniqueMembershipIds(input.ids);
    if (ids.length === 0) return new Map();
    const rows = await postgres.queryRows<LocationMembershipRow>(
        `WITH RECURSIVE location_tree AS (
             SELECT
                 id,
                 name,
                 kind,
                 parent_location_id,
                 floor_number,
                 room_number,
                 metadata
               FROM organization.locations
              WHERE organization_id = $1
                AND id = ANY($2::integer[])
             UNION
             SELECT
                 parent.id,
                 parent.name,
                 parent.kind,
                 parent.parent_location_id,
                 parent.floor_number,
                 parent.room_number,
                 parent.metadata
               FROM organization.locations parent
               JOIN location_tree child ON child.parent_location_id = parent.id
              WHERE parent.organization_id = $1
         )
         SELECT DISTINCT
             id,
             name,
             kind,
             parent_location_id,
             floor_number,
             room_number,
             metadata
           FROM location_tree`,
        [input.organizationId, ids]
    );
    return new Map(
        rows.map((row) => [
            row.id,
            {
                label: row.name,
                meta: locationMembershipMeta(row),
                parentId: row.parent_location_id
            }
        ])
    );
}

async function queryTagMembershipDetails(input: {
    organizationId: string;
    ids: readonly number[];
}): Promise<Map<number, MembershipTargetDetails>> {
    const ids = uniqueMembershipIds(input.ids);
    if (ids.length === 0) return new Map();
    const rows = await postgres.queryRows<TagMembershipRow>(
        `SELECT id, key, name, color, icon
           FROM organization.tags
          WHERE organization_id = $1
            AND id = ANY($2::integer[])`,
        [input.organizationId, ids]
    );
    return new Map(
        rows.map((row) => [
            row.id,
            {
                label: row.name,
                meta: {
                    key: row.key,
                    color: row.color,
                    icon: row.icon
                }
            }
        ])
    );
}

function membershipFact(
    input: MembershipFactInput
): RelationshipMembershipFact {
    const target = membershipTargetDetails(input);
    return {
        deviceExternalId: input.deviceExternalId,
        targetType: input.targetType,
        targetId: String(input.id),
        label: target?.label ?? `${input.targetType} ${input.id}`,
        imageAssetId: target?.imageAssetId,
        meta: target?.meta
    };
}

function membershipTargetDetails(
    input: Pick<MembershipFactInput, 'targetType' | 'id' | 'details'>
): MembershipTargetDetails | undefined {
    if (input.targetType === 'group') return input.details.groups.get(input.id);
    if (input.targetType === 'location') {
        return input.details.locations.get(input.id);
    }
    return input.details.tags.get(input.id);
}

function membershipHierarchyFacts(
    details: MembershipDetails
): RelationshipMembershipHierarchyFact[] {
    return [
        ...hierarchyFactsForTarget({
            targetType: 'group',
            details: details.groups
        }),
        ...hierarchyFactsForTarget({
            targetType: 'location',
            details: details.locations
        })
    ];
}

function hierarchyFactsForTarget(input: {
    targetType: RelationshipMembershipHierarchyFact['targetType'];
    details: Map<number, MembershipTargetDetails>;
}): RelationshipMembershipHierarchyFact[] {
    const facts: RelationshipMembershipHierarchyFact[] = [];
    for (const [childId, child] of input.details) {
        const parent = parentMembershipDetails({child, details: input.details});
        if (!parent) continue;
        facts.push({
            targetType: input.targetType,
            childId: String(childId),
            childLabel: child.label,
            parentId: String(child.parentId),
            parentLabel: parent.label,
            childImageAssetId: child.imageAssetId,
            parentImageAssetId: parent.imageAssetId,
            childMeta: child.meta,
            parentMeta: parent.meta
        });
    }
    return facts;
}

function parentMembershipDetails(input: {
    child: MembershipTargetDetails;
    details: Map<number, MembershipTargetDetails>;
}): MembershipTargetDetails | null {
    if (input.child.parentId === undefined || input.child.parentId === null) {
        return null;
    }
    return input.details.get(input.child.parentId) ?? null;
}

function groupMembershipMeta(row: GroupMembershipRow): Record<string, unknown> {
    return {
        groupType: row.group_type,
        parentGroupId: nullableString(row.parent_group_id),
        ...nonEmptyObjectMeta('visual', row.visual_json)
    };
}

function locationMembershipMeta(
    row: LocationMembershipRow
): Record<string, unknown> {
    return {
        kind: row.kind,
        parentLocationId: nullableString(row.parent_location_id),
        ...optionalNumberMeta('floorNumber', row.floor_number),
        ...optionalStringMeta('roomNumber', row.room_number),
        ...locationVisualizationMeta(row.metadata)
    };
}

function locationVisualizationMeta(
    metadata: Record<string, unknown> | null
): Record<string, unknown> {
    const viz = objectRecord(metadata?.viz);
    if (!viz) return {};
    return {
        ...floorPlanMeta(viz.floorPlan),
        ...arrayAvailabilityMeta('hasDevicePlacements', viz.devicePlacements),
        ...arrayCountMeta('zoneCount', viz.zones)
    };
}

function floorPlanMeta(value: unknown): Record<string, unknown> {
    const floorPlan = floorPlanReference(value);
    return floorPlan ? {floorPlan} : {};
}

function floorPlanReference(value: unknown): Record<string, unknown> | null {
    const objectValue = objectRecord(value);
    if (objectValue) return compactObject(safeFloorPlanFields(objectValue));
    if (
        typeof value === 'string' &&
        value.startsWith('/uploads/floor-plans/')
    ) {
        return {url: value};
    }
    return null;
}

function safeFloorPlanFields(
    value: Record<string, unknown>
): Record<string, unknown> {
    return {
        url: safeUploadUrl(value.url),
        widthPx: finiteNumber(value.widthPx),
        heightPx: finiteNumber(value.heightPx),
        contentType: optionalString(value.contentType),
        sizeBytes: finiteNumber(value.sizeBytes)
    };
}

function safeUploadUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.startsWith('/uploads/floor-plans/') ? value : undefined;
}

function arrayAvailabilityMeta(
    key: string,
    value: unknown
): Record<string, unknown> {
    return Array.isArray(value) && value.length > 0 ? {[key]: true} : {};
}

function arrayCountMeta(key: string, value: unknown): Record<string, unknown> {
    return Array.isArray(value) && value.length > 0
        ? {[key]: value.length}
        : {};
}

function nonEmptyObjectMeta(
    key: string,
    value: Record<string, unknown> | null
): Record<string, unknown> {
    if (!value || Object.keys(value).length === 0) return {};
    return {[key]: value};
}

function optionalNumberMeta(
    key: string,
    value: number | null
): Record<string, unknown> {
    return value === null ? {} : {[key]: value};
}

function optionalStringMeta(
    key: string,
    value: string | null
): Record<string, unknown> {
    return value ? {[key]: value} : {};
}

function compactObject(
    value: Record<string, unknown>
): Record<string, unknown> | null {
    const entries = Object.entries(value).filter(
        ([, entry]) => entry !== undefined
    );
    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function locationIds(memberships: DeviceMemberships): number[] {
    return memberships.locationId === null ? [] : [memberships.locationId];
}
