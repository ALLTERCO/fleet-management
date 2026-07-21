import {groupPolicy} from '../../config/groupPolicy';
import {assertAssetBelongsToOrg} from '../../modules/asset/assetRepository';
import {
    readableResourceAllowlists,
    readableResourceAllowlistsAsync,
    resolveReadableFilterIds
} from '../../modules/authz/evaluator/readableResourceAllowlists';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import {assertValidGroupKindMetadata} from '../../modules/groupKindValidator';
import {getGroupKind, listGroupKinds} from '../../modules/kindRepository';
import * as postgres from '../../modules/PostgresProvider';
import {translatePgError} from '../../rpc/dbErrors';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {AlertSeverity} from '../../types/api/alert';
import {
    GROUP_CHILDREN_PARAMS,
    GROUP_CREATE_PARAMS,
    GROUP_DELETE_PARAMS,
    GROUP_DESCRIBE,
    GROUP_GET_PARAMS,
    GROUP_KIND_GET_PARAMS,
    GROUP_KIND_LIST_PARAMS,
    GROUP_LIST_ACTIVITY_PARAMS,
    GROUP_LIST_DEVICE_MEMBERSHIPS_PARAMS,
    GROUP_LIST_MEMBERS_PARAMS,
    GROUP_LIST_PARAMS,
    GROUP_MEMBERS_PARAMS,
    GROUP_PATH_PARAMS,
    GROUP_UPDATE_PARAMS,
    type Group,
    type GroupActivityEntry,
    type GroupBreadcrumbEntry,
    type GroupKindGetParams,
    type GroupKindListParams,
    type GroupMemberRef,
    type GroupMemberSubjectType,
    type GroupType
} from '../../types/api/group';
import type CommandSender from '../CommandSender';
import Component from './Component';

interface GroupRow {
    id: number;
    organization_id: string;
    name: string;
    description: string | null;
    parent_group_id: number | null;
    group_type: GroupType;
    membership_mode: 'manual';
    kind: string;
    metadata: Record<string, unknown> | null;
    visual_json: Record<string, unknown> | null;
    image_asset_id: string | null;
    revision: number | string;
    is_legacy?: boolean;
    effective_severity_floor?: AlertSeverity | null;
    effective_retention_days?: number | string | null;
    effective_audit_retention_days?: number | string | null;
    created_at: Date | string;
    updated_at: Date | string | null;
    c_child_groups?: number | string | null;
    c_devices?: number | string | null;
    c_entities?: number | string | null;
    c_locations?: number | string | null;
    c_tags?: number | string | null;
    c_descendant_devices?: number | string | null;
    c_descendant_entities?: number | string | null;
}

type ListRow = Partial<GroupRow> & {total_count?: number | string};

interface MemberRow {
    group_id: number;
    subject_type: GroupMemberSubjectType;
    subject_id: string;
}

function subjectIntegerId(kind: string, subjectId: string): number {
    if (!/^[1-9]\d*$/.test(subjectId)) {
        throw RpcError.InvalidParams(`${kind} subjectId must be an integer`);
    }
    return Number(subjectId);
}

// Batched org-membership check for a list of group members. Runs at most one
// query per subject kind (locations, devices) instead of one per member.
// Throws the same RpcError.NotFound shape as the per-member path on the first
// missing reference, preserving caller-visible behavior.
export async function assertGroupMembersBelongToOrg(
    orgId: string,
    members: readonly GroupMemberRef[]
): Promise<void> {
    if (members.length === 0) return;

    const locationIds = new Set<number>();
    // Per shellyID, keep the original member so the NotFound error reports the
    // caller's subjectId (entity vs device) instead of the resolved shellyID.
    const shellyIdToMember = new Map<string, GroupMemberRef>();
    const legacyEntityMembers = new Map<string, GroupMemberRef>();

    for (const member of members) {
        if (member.subjectType === 'location') {
            locationIds.add(subjectIntegerId('location', member.subjectId));
            continue;
        }
        let shellyID = member.subjectId;
        if (member.subjectType === 'entity') {
            const ref = DeviceCollector.findEntityAndDevice(member.subjectId);
            if (!ref) {
                legacyEntityMembers.set(member.subjectId, member);
                continue;
            }
            shellyID = ref.device.shellyID;
        }
        if (!shellyIdToMember.has(shellyID)) {
            shellyIdToMember.set(shellyID, member);
        }
    }

    const normalizedLegacyEntities = new Set<string>();
    if (legacyEntityMembers.size > 0) {
        const rows = await postgres.queryRows<{subject_id: string}>(
            `SELECT input.subject_id
               FROM unnest($2::text[]) input(subject_id)
               CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
                   $1, input.subject_id
               ) normalized
              WHERE normalized.device_id IS NOT NULL`,
            [orgId, [...legacyEntityMembers.keys()]]
        );
        for (const row of rows) normalizedLegacyEntities.add(row.subject_id);
    }

    const foundLocations = new Set<number>();
    if (locationIds.size > 0) {
        const rows = await postgres.queryRows<{id: number}>(
            `SELECT id FROM organization.locations
              WHERE organization_id = $1 AND id = ANY($2::bigint[])`,
            [orgId, Array.from(locationIds)]
        );
        for (const row of rows) foundLocations.add(row.id);
    }

    const foundShellyIds = new Set<string>();
    if (shellyIdToMember.size > 0) {
        const rows = await postgres.queryRows<{external_id: string}>(
            `SELECT external_id FROM device.list
              WHERE organization_id = $1 AND external_id = ANY($2::text[])`,
            [orgId, Array.from(shellyIdToMember.keys())]
        );
        for (const row of rows) foundShellyIds.add(row.external_id);
    }

    for (const member of members) {
        if (member.subjectType === 'location') {
            const intId = subjectIntegerId('location', member.subjectId);
            if (!foundLocations.has(intId)) {
                throw RpcError.NotFound('location', member.subjectId);
            }
            continue;
        }
        if (
            member.subjectType === 'entity' &&
            legacyEntityMembers.has(member.subjectId)
        ) {
            if (!normalizedLegacyEntities.has(member.subjectId)) {
                throw RpcError.NotFound('entity', member.subjectId);
            }
            continue;
        }
        let shellyID = member.subjectId;
        if (member.subjectType === 'entity') {
            // Resolved once during admissions collection; re-resolve here
            // and re-throw if the entity disappeared mid-call.
            const ref = DeviceCollector.findEntityAndDevice(member.subjectId);
            if (!ref) throw RpcError.NotFound('entity', member.subjectId);
            shellyID = ref.device.shellyID;
        }
        if (!foundShellyIds.has(shellyID)) {
            throw RpcError.NotFound(member.subjectType, member.subjectId);
        }
    }
}

type MemberListRow = Partial<MemberRow & {created_at: Date | string}> & {
    total_count?: number | string;
};

interface ActivityRow {
    audit_id: number;
    ts: Date | string;
    event_type: string;
    username: string | null;
    shelly_id: string | null;
    shelly_ids: string[] | null;
    method: string | null;
    params: Record<string, unknown> | null;
    success: boolean;
    error_message: string | null;
}
type ActivityListRow = Partial<ActivityRow> & {total_count?: number | string};

function rowToActivityEntry(row: ActivityRow): GroupActivityEntry {
    return {
        auditId: row.audit_id,
        ts: toIso(row.ts) ?? '',
        eventType: row.event_type,
        username: row.username,
        shellyId: row.shelly_id,
        shellyIds: row.shelly_ids ?? [],
        method: row.method,
        params: row.params ?? {},
        success: row.success,
        errorMessage: row.error_message
    };
}

function toPositiveIntOrNull(value: unknown): number | null {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// Provenance per effective-policy field: 'set' if metadata.policy.<key> is
// present on THIS group, 'inherited' otherwise (value came from env default
// for the group's type).
function policySourcesFor(
    metadata: Record<string, unknown> | null
): Group['policySources'] {
    const policy =
        (metadata?.policy as Record<string, unknown> | undefined) ?? {};
    return {
        severityFloor: policy.severityFloor != null ? 'set' : 'inherited',
        retentionDays: policy.retentionDays != null ? 'set' : 'inherited',
        auditRetentionDays:
            policy.auditRetentionDays != null ? 'set' : 'inherited'
    };
}

function rowToGroup(row: GroupRow): Group {
    const metadata = row.metadata ?? {};
    const visual = (row.visual_json ?? {}) as Group['visual'];
    const g: Group = {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        parentGroupId: row.parent_group_id,
        groupType: row.group_type,
        membershipMode: row.membership_mode,
        kind: row.kind,
        metadata,
        visual,
        imageAssetId: row.image_asset_id,
        revision: Number(row.revision ?? 1),
        isLegacy: row.is_legacy ?? false,
        effectiveSeverityFloor: row.effective_severity_floor ?? null,
        effectiveRetentionDays: toPositiveIntOrNull(
            row.effective_retention_days
        ),
        effectiveAuditRetentionDays: toPositiveIntOrNull(
            row.effective_audit_retention_days
        ),
        policySources: policySourcesFor(metadata),
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
    if (row.c_child_groups != null) {
        g.counts = {
            childGroups: Number(row.c_child_groups),
            devices: Number(row.c_devices ?? 0),
            entities: Number(row.c_entities ?? 0),
            locations: Number(row.c_locations ?? 0),
            tags: Number(row.c_tags ?? 0),
            descendantDevices: Number(row.c_descendant_devices ?? 0),
            descendantEntities: Number(row.c_descendant_entities ?? 0)
        };
    }
    return g;
}

function memberRow(row: MemberRow): GroupMemberRef {
    return {subjectType: row.subject_type, subjectId: row.subject_id};
}

function toSqlSortBy(v: string | undefined): string {
    switch (v) {
        case 'groupType':
            return 'group_type';
        case 'createdAt':
            return 'created_at';
        case 'updatedAt':
            return 'updated_at';
        default:
            return 'name';
    }
}

type GroupOp = 'create' | 'update' | 'delete' | 'addMembers' | 'removeMembers';

/** Bundle the 12 env-default params fn_group_get/list/create/update accept. */
function policyDefaults(): Record<string, string | number | null> {
    const p = groupPolicy();
    return {
        p_default_floor_standard: p.severityFloorByType.standard,
        p_default_floor_operational: p.severityFloorByType.operational,
        p_default_floor_critical: p.severityFloorByType.critical,
        p_default_floor_custom: p.severityFloorByType.custom,
        p_default_retention_standard: p.retentionDaysByType.standard,
        p_default_retention_operational: p.retentionDaysByType.operational,
        p_default_retention_critical: p.retentionDaysByType.critical,
        p_default_retention_custom: p.retentionDaysByType.custom,
        p_default_audit_retention_standard: p.auditRetentionDaysByType.standard,
        p_default_audit_retention_operational:
            p.auditRetentionDaysByType.operational,
        p_default_audit_retention_critical: p.auditRetentionDaysByType.critical,
        p_default_audit_retention_custom: p.auditRetentionDaysByType.custom
    };
}

// Current kind for org-scoped update — patch.kind undefined => use this.
async function loadGroupKindOrThrow(
    orgId: string,
    id: number
): Promise<string> {
    const rows = await postgres.queryRows<{kind: string | null}>(
        `SELECT kind FROM organization.groups
          WHERE organization_id = $1 AND id = $2`,
        [orgId, id]
    );
    const row = rows[0];
    if (!row) throw RpcError.Domain('GroupNotFound', {details: {id}});
    return row.kind ?? 'manual';
}

// Current metadata for org-scoped update — patch.metadata undefined => use this.
async function loadGroupMetadataOrThrow(
    orgId: string,
    id: number
): Promise<Record<string, unknown>> {
    const rows = await postgres.queryRows<{
        metadata: Record<string, unknown> | null;
    }>(
        `SELECT metadata FROM organization.groups
          WHERE organization_id = $1 AND id = $2`,
        [orgId, id]
    );
    const row = rows[0];
    if (!row) throw RpcError.Domain('GroupNotFound', {details: {id}});
    return row.metadata ?? {};
}

function translateDbError(err: unknown, op: GroupOp): RpcError {
    return translatePgError(err, `group ${op}`, {
        unique: 'GroupNameConflict',
        // 23503 only means "has children" on delete. Other ops fall through.
        foreignKey:
            op === 'delete' ? 'GroupDeleteBlockedHasChildren' : undefined,
        // FM001 = legacy parent-change blocked; FM002 = stale revision.
        customCodes: {FM001: 'ResourceConflict', FM002: 'ResourceConflict'}
    });
}

export default class GroupComponent extends Component {
    constructor() {
        super('group', {
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
        return GROUP_DESCRIBE;
    }

    @Component.Expose('Create')
    @Component.CrudPermission('groups', 'create')
    async create(params: unknown, sender: CommandSender): Promise<Group> {
        const p = validateOrThrow<{
            organizationId?: string;
            name: string;
            description?: string | null;
            groupType?: GroupType;
            kind?: string;
            metadata?: Record<string, unknown>;
        }>(params, GROUP_CREATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const kind = p.kind ?? 'manual';
        // Kind-side check up front so we fail with InvalidParams instead
        // of a generic FK error from the PG layer.
        await assertValidGroupKindMetadata(kind, orgId, p.metadata);

        try {
            const result = await postgres.callMethod(
                'organization.fn_group_create',
                {
                    p_organization_id: orgId,
                    p_name: p.name.trim(),
                    p_description: p.description ?? null,
                    p_parent_group_id: null,
                    p_group_type: p.groupType ?? 'standard',
                    p_metadata: p.metadata ?? {},
                    p_kind: kind,
                    ...policyDefaults()
                }
            );
            const row = result?.rows?.[0] as GroupRow | undefined;
            if (!row) throw RpcError.OperationFailed('group create');
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitGroupCreated(row.id, row.name, orgId);
            return rowToGroup(row);
        } catch (err: unknown) {
            throw translateDbError(err, 'create');
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission('groups', 'update', (p) => p?.id)
    async update(params: unknown, sender: CommandSender): Promise<Group> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            expectedRevision?: number;
            patch: {
                name?: string;
                description?: string | null;
                groupType?: GroupType;
                kind?: string;
                metadata?: Record<string, unknown>;
                visual?: Record<string, unknown>;
                imageAssetId?: string | null;
            };
        }>(params, GROUP_UPDATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const patch = p.patch ?? {};
        const clearDescription = patch.description === null;
        const clearImage = patch.imageAssetId === null;
        if (!clearImage) {
            await assertAssetBelongsToOrg(orgId, patch.imageAssetId);
        }
        // Validate against the effective kind (patch wins, else current).
        // Only when the patch actually touches metadata or kind — otherwise
        // there's nothing to re-check.
        if (patch.metadata !== undefined || patch.kind !== undefined) {
            const effectiveKind =
                patch.kind ?? (await loadGroupKindOrThrow(orgId, p.id));
            const effectiveMetadata =
                patch.metadata ?? (await loadGroupMetadataOrThrow(orgId, p.id));
            await assertValidGroupKindMetadata(
                effectiveKind,
                orgId,
                effectiveMetadata
            );
        }

        try {
            const result = await postgres.callMethod(
                'organization.fn_group_update',
                {
                    p_organization_id: orgId,
                    p_id: p.id,
                    p_expected_revision: p.expectedRevision ?? null,
                    p_name: patch.name?.trim() ?? null,
                    p_description: clearDescription
                        ? null
                        : (patch.description ?? null),
                    p_clear_description: clearDescription,
                    p_parent_group_id: null,
                    p_clear_parent: false,
                    p_group_type: patch.groupType ?? null,
                    p_metadata: patch.metadata ?? null,
                    p_visual_json: patch.visual ?? null,
                    p_image_asset_id: clearImage
                        ? null
                        : (patch.imageAssetId ?? null),
                    p_clear_image: clearImage,
                    p_kind: patch.kind ?? null,
                    ...policyDefaults()
                }
            );
            const row = result?.rows?.[0] as GroupRow | undefined;
            if (!row)
                throw RpcError.Domain('GroupNotFound', {details: {id: p.id}});
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitGroupUpdated(row.id, row.name, orgId);
            return rowToGroup(row);
        } catch (err: unknown) {
            throw translateDbError(err, 'update');
        }
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('groups', 'delete', (p) => p?.id)
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean; id: number}> {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            GROUP_DELETE_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod(
                'organization.fn_group_delete',
                {p_organization_id: orgId, p_id: p.id}
            );
            const row = result?.rows?.[0] as {id: number} | undefined;
            const deleted = row?.id != null;
            if (deleted) {
                EventDistributor.invalidateGroupCache(orgId);
                EventDistributor.emitGroupDeleted(p.id, orgId);
            }
            return {deleted, id: p.id};
        } catch (err: unknown) {
            throw translateDbError(err, 'delete');
        }
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('groups', 'read', (p) => p?.id)
    async get(params: unknown, sender: CommandSender): Promise<Group> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            includeSummary?: boolean;
        }>(params, GROUP_GET_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod('organization.fn_group_get', {
            p_organization_id: orgId,
            p_id: p.id,
            p_include_summary: p.includeSummary ?? false,
            p_allowed_group_ids: scope.groups,
            p_allowed_device_ids: scope.devices,
            p_allowed_location_ids: scope.locations,
            p_allowed_tag_ids: scope.tags,
            ...policyDefaults()
        });
        const row = result?.rows?.[0] as GroupRow | undefined;
        if (!row) throw RpcError.Domain('GroupNotFound', {details: {id: p.id}});
        return rowToGroup(row);
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('groups', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            parentGroupId?: number | null;
            query?: string;
            groupType?: GroupType;
            includeSummary?: boolean;
            limit?: number;
            offset?: number;
            sortBy?: string;
            sortDir?: 'asc' | 'desc';
        }>(params, GROUP_LIST_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;
        const rootsOnly = p.parentGroupId === null;
        const parentId =
            typeof p.parentGroupId === 'number' ? p.parentGroupId : null;

        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod('organization.fn_group_list', {
            p_organization_id: orgId,
            p_parent_id: parentId,
            p_roots_only: rootsOnly,
            p_query: p.query ?? null,
            p_group_type: p.groupType ?? null,
            p_limit: limit,
            p_offset: offset,
            p_sort_by: toSqlSortBy(p.sortBy),
            p_sort_dir: p.sortDir ?? 'asc',
            p_allowed_ids: scope.groups,
            p_include_summary: p.includeSummary ?? false,
            p_allowed_device_ids: scope.devices,
            p_allowed_location_ids: scope.locations,
            p_allowed_tag_ids: scope.tags,
            ...policyDefaults()
        });
        const rows = (result?.rows ?? []) as ListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: Group[] = [];
        for (const r of rows) {
            if (r.id == null) continue;
            items.push(rowToGroup(r as GroupRow));
        }
        return buildListResponse(items, total, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('Children')
    @Component.CrudPermission('groups', 'read', (p) => p?.id)
    async children(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            includeSummary?: boolean;
            limit?: number;
            offset?: number;
        }>(params, GROUP_CHILDREN_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod('organization.fn_group_list', {
            p_organization_id: orgId,
            p_parent_id: p.id,
            p_roots_only: false,
            p_query: null,
            p_group_type: null,
            p_limit: limit,
            p_offset: offset,
            p_sort_by: 'name',
            p_sort_dir: 'asc',
            p_allowed_ids: scope.groups,
            p_include_summary: p.includeSummary ?? false,
            p_allowed_device_ids: scope.devices,
            p_allowed_location_ids: scope.locations,
            p_allowed_tag_ids: scope.tags,
            ...policyDefaults()
        });
        const rows = (result?.rows ?? []) as ListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: Group[] = [];
        for (const r of rows) {
            if (r.id == null) continue;
            items.push(rowToGroup(r as GroupRow));
        }
        return buildListResponse(items, total, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('Path')
    @Component.CrudPermission('groups', 'read', (p) => p?.id)
    async path(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            GROUP_PATH_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);

        const result = await postgres.callMethod('organization.fn_group_path', {
            p_organization_id: orgId,
            p_id: p.id
        });
        const rows = (result?.rows ?? []) as Array<{
            id: number;
            name: string;
        }>;
        if (rows.length === 0)
            throw RpcError.Domain('GroupNotFound', {details: {id: p.id}});
        const items: GroupBreadcrumbEntry[] = rows.map((r) => ({
            id: r.id,
            name: r.name
        }));
        return {items};
    }

    @Component.NoAudit
    @Component.Expose('ListMembers')
    @Component.CrudPermission('groups', 'read', (p) => p?.id)
    async listMembers(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            subjectType?: GroupMemberSubjectType;
            limit?: number;
            offset?: number;
        }>(params, GROUP_LIST_MEMBERS_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        const result = await postgres.callMethod(
            'organization.fn_group_list_members',
            {
                p_organization_id: orgId,
                p_group_id: p.id,
                p_subject_type: p.subjectType ?? null,
                p_limit: limit,
                p_offset: offset
            }
        );
        const rows = (result?.rows ?? []) as MemberListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: GroupMemberRef[] = [];
        for (const r of rows) {
            if (r.subject_id == null || r.subject_type == null) continue;
            items.push({
                subjectType: r.subject_type,
                subjectId: r.subject_id
            });
        }
        return buildListResponse(items, total, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('ListActivity')
    @Component.CrudPermission('groups', 'read', (p) => p?.id)
    async listActivity(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            from?: string;
            to?: string;
            eventTypes?: string[];
            includeDescendants?: boolean;
            limit?: number;
            offset?: number;
        }>(params, GROUP_LIST_ACTIVITY_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        // Scope guard — confirm caller can read the group before we
        // expose its devices' audit trail.
        const scope = await readableResourceAllowlistsAsync(sender);
        const guard = await postgres.callMethod('organization.fn_group_get', {
            p_organization_id: orgId,
            p_id: p.id,
            p_include_summary: false,
            p_allowed_group_ids: scope.groups,
            p_allowed_device_ids: scope.devices,
            p_allowed_location_ids: scope.locations,
            p_allowed_tag_ids: scope.tags,
            ...policyDefaults()
        });
        if (!guard?.rows?.[0]) {
            throw RpcError.Domain('GroupNotFound', {details: {id: p.id}});
        }

        const result = await postgres.callMethod(
            'organization.fn_group_list_activity',
            {
                p_organization_id: orgId,
                p_group_id: p.id,
                p_from: p.from ?? null,
                p_to: p.to ?? null,
                p_event_types:
                    p.eventTypes && p.eventTypes.length > 0
                        ? p.eventTypes
                        : null,
                p_include_descendants: p.includeDescendants ?? true,
                p_limit: limit,
                p_offset: offset
            }
        );
        const rows = (result?.rows ?? []) as ActivityListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: GroupActivityEntry[] = [];
        for (const r of rows) {
            if (r.audit_id == null) continue;
            items.push(rowToActivityEntry(r as ActivityRow));
        }
        return buildListResponse(items, total, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('ListDeviceMemberships')
    @Component.CrudPermission('groups', 'read')
    async listDeviceMemberships(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            ids?: number[];
        }>(params, GROUP_LIST_DEVICE_MEMBERSHIPS_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const filterIds = resolveReadableFilterIds(
            readableResourceAllowlists(sender).groups,
            p.ids
        );
        if (filterIds === 'none') return {items: []};
        const rows = await postgres.listGroupDeviceMemberships(
            orgId,
            filterIds ?? undefined
        );
        return {
            items: rows.map((r) => ({
                groupId: r.group_id,
                subjectId: r.subject_id
            }))
        };
    }

    @Component.Expose('AddMembers')
    @Component.CrudPermission('groups', 'update', (p) => p?.id)
    async addMembers(
        params: unknown,
        sender: CommandSender
    ): Promise<{id: number; added: GroupMemberRef[]}> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            members: GroupMemberRef[];
        }>(params, GROUP_MEMBERS_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        await assertGroupMembersBelongToOrg(orgId, p.members);

        const types = p.members.map((m) => m.subjectType);
        const ids = p.members.map((m) => m.subjectId);

        try {
            const result = await postgres.callMethod(
                'organization.fn_group_add_members_batch',
                {
                    p_organization_id: orgId,
                    p_group_id: p.id,
                    p_subject_types: types,
                    p_subject_ids: ids
                }
            );
            const rows = (result?.rows ?? []) as MemberRow[];
            const added = rows.map(memberRow);
            if (added.length > 0) {
                EventDistributor.invalidateGroupCache(orgId);
                EventDistributor.emitGroupMembersAdded(p.id, added, orgId);
            }
            return {id: p.id, added};
        } catch (err: unknown) {
            throw translateDbError(err, 'addMembers');
        }
    }

    @Component.Expose('RemoveMembers')
    @Component.CrudPermission('groups', 'update', (p) => p?.id)
    async removeMembers(
        params: unknown,
        sender: CommandSender
    ): Promise<{id: number; removed: GroupMemberRef[]}> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            members: GroupMemberRef[];
        }>(params, GROUP_MEMBERS_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const types = p.members.map((m) => m.subjectType);
        const ids = p.members.map((m) => m.subjectId);

        try {
            const result = await postgres.callMethod(
                'organization.fn_group_remove_members_batch',
                {
                    p_organization_id: orgId,
                    p_group_id: p.id,
                    p_subject_types: types,
                    p_subject_ids: ids
                }
            );
            const rows = (result?.rows ?? []) as MemberRow[];
            const removed = rows.map(memberRow);
            if (removed.length > 0) {
                EventDistributor.invalidateGroupCache(orgId);
                EventDistributor.emitGroupMembersRemoved(p.id, removed, orgId);
            }
            return {id: p.id, removed};
        } catch (err: unknown) {
            throw translateDbError(err, 'removeMembers');
        }
    }

    // --- Group.Kind.* — read-only catalog of typed bucket kinds --------

    @Component.NoAudit
    @Component.Expose('Kind.List')
    @Component.CrudPermission('groups', 'read')
    async kindList(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<GroupKindListParams>(
            params ?? {},
            GROUP_KIND_LIST_PARAMS
        );
        const items = await listGroupKinds({
            organizationId: requireOrganizationId(sender),
            category: p.category,
            query: p.query
        });
        return {items};
    }

    @Component.NoAudit
    @Component.Expose('Kind.Get')
    @Component.CrudPermission('groups', 'read')
    async kindGet(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<GroupKindGetParams>(
            params,
            GROUP_KIND_GET_PARAMS
        );
        const kind = await getGroupKind(p.id, requireOrganizationId(sender));
        if (!kind) throw RpcError.NotFound('kind', p.id);
        return kind;
    }
}
