import {readableResourceAllowlistsAsync} from '../../modules/authz/evaluator/readableResourceAllowlists';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import * as postgres from '../../modules/PostgresProvider';
import {translatePgError} from '../../rpc/dbErrors';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    TAG_ASSIGN_PARAMS,
    TAG_CREATE_PARAMS,
    TAG_DELETE_PARAMS,
    TAG_DESCRIBE,
    TAG_GET_PARAMS,
    TAG_LIST_ASSIGNMENTS_PARAMS,
    TAG_LIST_PARAMS,
    TAG_UNASSIGN_PARAMS,
    TAG_UPDATE_PARAMS,
    type Tag,
    type TagAssignmentRef,
    type TagSubjectType
} from '../../types/api/tag';
import type CommandSender from '../CommandSender';
import Component from './Component';

interface TagRow {
    id: number;
    organization_id: string;
    key: string;
    name: string;
    description: string | null;
    color: string | null;
    icon: string | null;
    metadata: Record<string, unknown> | null;
    image_asset_id: string | null;
    created_at: Date | string;
    updated_at: Date | string | null;
    counts?: Record<string, number | string> | null;
}

// fn_tag_list always emits total_count; row columns are NULL on empty pages.
type ListRow = Partial<TagRow> & {total_count?: number | string};

interface AssignmentRow {
    tag_id: number;
    subject_type: TagSubjectType;
    subject_id: string;
}
type AssignmentListRow = Partial<
    AssignmentRow & {created_at: Date | string}
> & {
    total_count?: number | string;
};

function subjectIntegerId(kind: string, subjectId: string): number {
    if (!/^[1-9]\d*$/.test(subjectId)) {
        throw RpcError.InvalidParams(`${kind} subjectId must be an integer`);
    }
    return Number(subjectId);
}

// Allowlist — only these reach SQL, never user input.
const INTEGER_SUBJECT_TABLES: Partial<Record<TagSubjectType, string>> = {
    location: 'organization.locations',
    group: 'organization.groups',
    alert_rule: 'notifications.alert_rules',
    destination_group: 'notifications.destination_groups',
    channel: 'notifications.channels'
};

async function assertIntegerSubjectExists(
    orgId: string,
    kind: TagSubjectType,
    table: string,
    subjectId: string
): Promise<void> {
    const rows = await postgres.queryRows(
        `SELECT 1 FROM ${table}
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [orgId, subjectIntegerId(kind, subjectId)]
    );
    if (rows.length === 0) {
        throw RpcError.NotFound(kind, subjectId);
    }
}

export async function assertTagSubjectBelongsToOrg(
    orgId: string,
    subject: TagAssignmentRef
): Promise<void> {
    const table = INTEGER_SUBJECT_TABLES[subject.subjectType];
    if (table) {
        await assertIntegerSubjectExists(
            orgId,
            subject.subjectType,
            table,
            subject.subjectId
        );
        return;
    }
    if (subject.subjectType !== 'device' && subject.subjectType !== 'entity') {
        return;
    }

    let shellyID = subject.subjectId;
    if (subject.subjectType === 'entity') {
        const ref = DeviceCollector.findEntityAndDevice(subject.subjectId);
        if (!ref) {
            const rows = await postgres.queryRows(
                `SELECT 1
                   FROM organization.fn_normalize_entity_subject($1, $2)
                  WHERE device_id IS NOT NULL`,
                [orgId, subject.subjectId]
            );
            if (rows.length === 0) {
                throw RpcError.NotFound('entity', subject.subjectId);
            }
            return;
        }
        shellyID = ref.device.shellyID;
    }
    const rows = await postgres.queryRows(
        `SELECT 1 FROM device.list
          WHERE organization_id = $1 AND external_id = $2
          LIMIT 1`,
        [orgId, shellyID]
    );
    if (rows.length === 0) {
        throw RpcError.NotFound(subject.subjectType, subject.subjectId);
    }
}

function rowToTag(row: TagRow): Tag {
    const t: Tag = {
        id: row.id,
        organizationId: row.organization_id,
        key: row.key,
        name: row.name,
        description: row.description,
        color: row.color,
        icon: row.icon,
        metadata: row.metadata ?? {},
        imageAssetId: row.image_asset_id ?? null,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
    // pg may hand back jsonb numeric as string; coerce.
    if (row.counts != null) {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(row.counts)) out[k] = Number(v);
        t.counts = out;
    }
    return t;
}

// Matches tags_key_pattern CHECK in 2004_tags.sql and KEY_SCHEMA.
const KEY_MAX_LEN = 64;
const KEY_MIN_LEN = 2;
const KEY_FALLBACK = 'tag';
// Cap auto-key collision retries so we fail loudly instead of looping.
const KEY_RETRY_LIMIT = 100;

// Translate name → valid key per spec §7.4 (`^[a-z0-9][a-z0-9._-]{1,63}$`).
function slugifyKey(name: string): string {
    const normalized = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (normalized.length < KEY_MIN_LEN) return KEY_FALLBACK;
    return normalized.slice(0, KEY_MAX_LEN);
}

// Sort-by mapping: spec uses camelCase; SQL function expects snake_case.
function toSqlSortBy(v: string | undefined): string {
    switch (v) {
        case 'name':
            return 'name';
        case 'createdAt':
            return 'created_at';
        case 'updatedAt':
            return 'updated_at';
        default:
            return 'key';
    }
}

function buildKeyCandidates(base: string): string[] {
    const candidates: string[] = [base];
    for (let n = 2; n <= KEY_RETRY_LIMIT; n++) {
        const suffix = `-${n}`;
        candidates.push(base.slice(0, KEY_MAX_LEN - suffix.length) + suffix);
    }
    return candidates;
}

async function resolveUniqueKey(orgId: string, base: string): Promise<string> {
    // Generate every candidate up-front, ask DB which ones already exist
    // in one round-trip, then pick the first unused candidate.
    const candidates = buildKeyCandidates(base);
    const result = await postgres.callMethod(
        'organization.fn_tag_keys_filter_existing',
        {
            p_organization_id: orgId,
            p_keys: candidates
        }
    );
    const taken = new Set(
        ((result?.rows ?? []) as Array<{key: string}>).map((r) => r.key)
    );
    const available = candidates.find((k) => !taken.has(k));
    if (available) return available;
    throw RpcError.InvalidRequest(
        'Unable to derive a unique tag key from the given name.'
    );
}

export default class TagComponent extends Component {
    constructor() {
        super('tag', {
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
        return TAG_DESCRIBE;
    }

    @Component.Expose('Create')
    @Component.CrudPermission('tags', 'create')
    async create(params: unknown, sender: CommandSender): Promise<Tag> {
        const p = validateOrThrow<{
            organizationId?: string;
            key?: string;
            name: string;
            description?: string | null;
            color?: string | null;
            icon?: string | null;
            metadata?: Record<string, unknown>;
            imageAssetId?: string | null;
        }>(params, TAG_CREATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const key = p.key
            ? p.key.toLowerCase()
            : await resolveUniqueKey(orgId, slugifyKey(p.name));

        try {
            const result = await postgres.callMethod(
                'organization.fn_tag_create',
                {
                    p_organization_id: orgId,
                    p_key: key,
                    p_name: p.name.trim(),
                    p_description: p.description ?? null,
                    p_color: p.color ?? null,
                    p_icon: p.icon ?? null,
                    p_metadata: p.metadata ?? {},
                    p_image_asset_id: p.imageAssetId ?? null
                }
            );
            const row = result?.rows?.[0] as TagRow | undefined;
            if (!row) throw RpcError.OperationFailed('tag create');
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitTagCreated(row.id, row.key, row.name, orgId);
            return rowToTag(row);
        } catch (err: unknown) {
            throw translateDbError(err, 'create');
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission('tags', 'update', (p) => p?.id)
    async update(params: unknown, sender: CommandSender): Promise<Tag> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                description?: string | null;
                color?: string | null;
                icon?: string | null;
                metadata?: Record<string, unknown>;
                imageAssetId?: string | null;
            };
        }>(params, TAG_UPDATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const patch = p.patch ?? {};
        const clearDescription = patch.description === null;
        const clearColor = patch.color === null;
        const clearIcon = patch.icon === null;
        const clearImageAssetId = patch.imageAssetId === null;

        try {
            const result = await postgres.callMethod(
                'organization.fn_tag_update',
                {
                    p_organization_id: orgId,
                    p_id: p.id,
                    p_name: patch.name?.trim() ?? null,
                    p_description: clearDescription
                        ? null
                        : (patch.description ?? null),
                    p_clear_description: clearDescription,
                    p_color: clearColor ? null : (patch.color ?? null),
                    p_clear_color: clearColor,
                    p_icon: clearIcon ? null : (patch.icon ?? null),
                    p_clear_icon: clearIcon,
                    p_metadata: patch.metadata ?? null,
                    p_image_asset_id: clearImageAssetId
                        ? null
                        : (patch.imageAssetId ?? null),
                    p_clear_image_asset_id: clearImageAssetId
                }
            );
            const row = result?.rows?.[0] as TagRow | undefined;
            if (!row)
                throw RpcError.Domain('TagNotFound', {details: {id: p.id}});
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitTagUpdated(row.id, row.key, row.name, orgId);
            return rowToTag(row);
        } catch (err: unknown) {
            throw translateDbError(err, 'update');
        }
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('tags', 'delete', (p) => p?.id)
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean; id: number}> {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            TAG_DELETE_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod(
                'organization.fn_tag_delete',
                {p_organization_id: orgId, p_id: p.id}
            );
            const row = result?.rows?.[0] as {id: number} | undefined;
            const deleted = row?.id != null;
            if (deleted) {
                EventDistributor.invalidateGroupCache(orgId);
                EventDistributor.emitTagDeleted(p.id, orgId);
            }
            return {deleted, id: p.id};
        } catch (err: unknown) {
            throw translateDbError(err, 'delete');
        }
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('tags', 'read', (p) => p?.id)
    async get(params: unknown, sender: CommandSender): Promise<Tag> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            includeSummary?: boolean;
        }>(params, TAG_GET_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod('organization.fn_tag_get', {
            p_organization_id: orgId,
            p_id: p.id,
            p_include_summary: p.includeSummary ?? false,
            p_allowed_device_ids: scope.devices,
            p_allowed_group_ids: scope.groups,
            p_allowed_location_ids: scope.locations
        });
        const row = result?.rows?.[0] as TagRow | undefined;
        if (!row) throw RpcError.Domain('TagNotFound', {details: {id: p.id}});
        return rowToTag(row);
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('tags', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            query?: string;
            key?: string;
            includeSummary?: boolean;
            limit?: number;
            offset?: number;
            sortBy?: string;
            sortDir?: 'asc' | 'desc';
        }>(params, TAG_LIST_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod('organization.fn_tag_list', {
            p_organization_id: orgId,
            p_query: p.query ?? null,
            p_key: p.key ?? null,
            p_limit: limit,
            p_offset: offset,
            p_sort_by: toSqlSortBy(p.sortBy),
            p_sort_dir: p.sortDir ?? 'asc',
            p_include_summary: p.includeSummary ?? false,
            p_allowed_device_ids: scope.devices,
            p_allowed_group_ids: scope.groups,
            p_allowed_location_ids: scope.locations
        });
        const rows = (result?.rows ?? []) as ListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: Tag[] = [];
        for (const r of rows) {
            if (r.id == null) continue;
            items.push(rowToTag(r as TagRow));
        }
        return buildListResponse(items, total, limit, offset);
    }

    @Component.Expose('Assign')
    @Component.CrudPermission('tags', 'update', (p) => p?.id)
    async assign(
        params: unknown,
        sender: CommandSender
    ): Promise<{id: number; assigned: TagAssignmentRef[]}> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            subjects: TagAssignmentRef[];
        }>(params, TAG_ASSIGN_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        for (const subject of p.subjects) {
            await assertTagSubjectBelongsToOrg(orgId, subject);
        }

        const types = p.subjects.map((s) => s.subjectType);
        const ids = p.subjects.map((s) => s.subjectId);

        try {
            const result = await postgres.callMethod(
                'organization.fn_tag_assign_batch',
                {
                    p_organization_id: orgId,
                    p_tag_id: p.id,
                    p_subject_types: types,
                    p_subject_ids: ids
                }
            );
            const rows = (result?.rows ?? []) as AssignmentRow[];
            const assigned = rows.map(rowToRef);
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitTagAssigned(p.id, assigned, orgId);
            return {id: p.id, assigned};
        } catch (err: unknown) {
            throw translateDbError(err, 'assign');
        }
    }

    @Component.Expose('Unassign')
    @Component.CrudPermission('tags', 'update', (p) => p?.id)
    async unassign(
        params: unknown,
        sender: CommandSender
    ): Promise<{id: number; unassigned: TagAssignmentRef[]}> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            subjects: TagAssignmentRef[];
        }>(params, TAG_UNASSIGN_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const types = p.subjects.map((s) => s.subjectType);
        const ids = p.subjects.map((s) => s.subjectId);

        try {
            const result = await postgres.callMethod(
                'organization.fn_tag_unassign_batch',
                {
                    p_organization_id: orgId,
                    p_tag_id: p.id,
                    p_subject_types: types,
                    p_subject_ids: ids
                }
            );
            const rows = (result?.rows ?? []) as AssignmentRow[];
            const unassigned = rows.map(rowToRef);
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitTagUnassigned(p.id, unassigned, orgId);
            return {id: p.id, unassigned};
        } catch (err: unknown) {
            throw translateDbError(err, 'unassign');
        }
    }

    @Component.NoAudit
    @Component.Expose('ListAssignments')
    @Component.CrudPermission('tags', 'read', (p) => p?.id)
    async listAssignments(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            subjectType?: TagSubjectType;
            limit?: number;
            offset?: number;
        }>(params, TAG_LIST_ASSIGNMENTS_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        const result = await postgres.callMethod(
            'organization.fn_tag_list_assignments',
            {
                p_organization_id: orgId,
                p_tag_id: p.id,
                p_subject_type: p.subjectType ?? null,
                p_limit: limit,
                p_offset: offset
            }
        );
        const rows = (result?.rows ?? []) as AssignmentListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: TagAssignmentRef[] = [];
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
    @Component.Expose('ListForSubject')
    @Component.CrudPermission('tags', 'read')
    async listForSubject(
        params: unknown,
        sender: CommandSender
    ): Promise<{tagIds: number[]}> {
        const p = validateOrThrow<{
            subjectType: TagSubjectType;
            subjectId: string;
        }>(params, {
            type: 'object',
            required: ['subjectType', 'subjectId'],
            additionalProperties: false,
            properties: {
                subjectType: {type: 'string'},
                subjectId: {type: 'string', minLength: 1, maxLength: 255}
            }
        });
        const orgId = requireOrganizationId(sender);
        const result = await postgres.callMethod(
            'organization.fn_tag_ids_for_subject',
            {
                p_organization_id: orgId,
                p_subject_type: p.subjectType,
                p_subject_id: p.subjectId
            }
        );
        const rows = (result?.rows ?? []) as Array<{tag_id: number}>;
        return {tagIds: rows.map((r) => Number(r.tag_id))};
    }
}

function rowToRef(row: AssignmentRow): TagAssignmentRef {
    return {subjectType: row.subject_type, subjectId: row.subject_id};
}

type TagOp = 'create' | 'update' | 'delete' | 'assign' | 'unassign';

function translateDbError(err: unknown, operation: TagOp): RpcError {
    return translatePgError(err, `tag ${operation}`, {
        unique: 'TagKeyConflict',
        checkViolation: (constraint) =>
            constraint === 'tags_key_pattern'
                ? 'TagKeyInvalid'
                : 'InvalidPatchField'
    });
}
