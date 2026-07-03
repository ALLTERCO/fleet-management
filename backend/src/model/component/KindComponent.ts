// kind.* — vendor catalog + per-org custom kinds. Reads merge both sources via
// the resolver; writes manage only this org's custom kinds.

import {GROUP_KIND_CATALOG} from '../../config/groupKindCatalog';
import {
    countKindReferences,
    createCustomKind,
    deleteCustomKind,
    isDuplicateSlugError,
    updateCustomKind
} from '../../modules/kindRepository';
import {listKindsFor, resolveKind} from '../../modules/kindResolver';
import {incrementCounter} from '../../modules/Observability';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    KIND_CREATE_PARAMS_SCHEMA,
    KIND_DELETE_PARAMS_SCHEMA,
    KIND_DESCRIBE,
    KIND_GET_PARAMS_SCHEMA,
    KIND_LIST_PARAMS_SCHEMA,
    KIND_UPDATE_PARAMS_SCHEMA,
    type KindCreateParams,
    type KindDeleteParams,
    type KindGetParams,
    type KindListParams,
    type KindUpdateParams
} from '../../types/api/kind';
import type CommandSender from '../CommandSender';
import Component from './Component';

const VALID_CATEGORIES = new Set(GROUP_KIND_CATALOG.map((k) => k.category));

// Custom kinds reuse vendor categories so section gating stays predictable.
function assertVendorCategory(category: string): void {
    if (!VALID_CATEGORIES.has(category as never)) {
        throw RpcError.InvalidParams(
            `Unknown category '${category}' — custom kinds reuse vendor categories`
        );
    }
}

function requireOrg(sender: CommandSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

// Turn a duplicate-slug DB error into a clean client error; re-throw the rest.
function rejectDuplicateSlug(err: unknown, slug: string): never {
    if (isDuplicateSlugError(err)) {
        throw RpcError.InvalidParams(
            `A kind with slug '${slug}' already exists`
        );
    }
    throw err;
}

export default class KindComponent extends Component {
    constructor() {
        super('kind', {
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
        return KIND_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<KindListParams>(
            params,
            KIND_LIST_PARAMS_SCHEMA
        );
        return {
            kinds: await listKindsFor(requireOrg(sender), p.appliesTo ?? 'both')
        };
    }

    @Component.Expose('Get')
    @Component.CrudPermission('devices', 'read')
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<KindGetParams>(
            params,
            KIND_GET_PARAMS_SCHEMA
        );
        const kind = await resolveKind(p.id, requireOrg(sender));
        if (!kind) throw RpcError.NotFound('Kind', p.id);
        return kind;
    }

    @Component.Expose('Create')
    @Component.CrudPermission('devices', 'update')
    async create(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<KindCreateParams>(
            params,
            KIND_CREATE_PARAMS_SCHEMA
        );
        assertVendorCategory(p.category);
        try {
            const created = await createCustomKind(requireOrg(sender), p.slug, {
                name: p.name,
                category: p.category,
                icon: p.icon ?? null,
                appliesTo: p.appliesTo
            });
            incrementCounter('fm_custom_kind_created');
            return created;
        } catch (err) {
            rejectDuplicateSlug(err, p.slug);
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission('devices', 'update')
    async update(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<KindUpdateParams>(
            params,
            KIND_UPDATE_PARAMS_SCHEMA
        );
        assertVendorCategory(p.category);
        const updated = await updateCustomKind(p.id, requireOrg(sender), {
            name: p.name,
            category: p.category,
            icon: p.icon ?? null,
            appliesTo: p.appliesTo
        });
        if (!updated) throw RpcError.NotFound('Kind', p.id);
        return updated;
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update')
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<KindDeleteParams>(
            params,
            KIND_DELETE_PARAMS_SCHEMA
        );
        const orgId = requireOrg(sender);
        const refs = await countKindReferences(p.id);
        if (refs > 0) {
            throw RpcError.OperationFailed(
                `delete kind ${p.id} — still referenced by ${refs} device(s) or group(s)`
            );
        }
        if (!(await deleteCustomKind(p.id, orgId))) {
            throw RpcError.NotFound('Kind', p.id);
        }
        return {deleted: true};
    }
}
