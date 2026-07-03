import {authzAuditWriter} from '../../modules/authz/audit';
import * as store from '../../modules/PostgresProvider';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PERSONA_CREATE_PARAMS_SCHEMA,
    PERSONA_DELETE_PARAMS_SCHEMA,
    PERSONA_DESCRIBE,
    PERSONA_GET_PARAMS_SCHEMA,
    PERSONA_LIST_PARAMS_SCHEMA,
    PERSONA_UPDATE_PARAMS_SCHEMA,
    type PersonaCreateParams,
    type PersonaDeleteParams,
    type PersonaGetParams,
    type PersonaListParams,
    type PersonaResponse,
    type PersonaUpdateParams
} from '../../types/api/persona';
import type CommandSender from '../CommandSender';
import {canManageAuthz, canReadPolicies} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

async function callPersonaRows(
    fn: string,
    params: Record<string, unknown>
): Promise<PersonaResponse[]> {
    const result = await store.callMethod(fn, params);
    return (result?.rows ?? []) as PersonaResponse[];
}

export default class PersonaComponent extends Component<Config> {
    constructor() {
        super('persona', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return PERSONA_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canReadPolicies)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<PersonaListParams>(
            params,
            PERSONA_LIST_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await callPersonaRows('organization.fn_persona_list', {
            p_tenant_id: orgId,
            p_include_system: p?.includeSystem ?? true
        });
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canReadPolicies)
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<PersonaGetParams>(
            params,
            PERSONA_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await callPersonaRows('organization.fn_persona_get', {
            p_id: p.id,
            p_tenant_id: orgId
        });
        if (rows.length === 0) throw RpcError.NotFound('persona');
        return rows[0];
    }

    @Component.Expose('Create')
    @Component.CheckPermissions(canManageAuthz)
    async create(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<PersonaCreateParams>(
            params,
            PERSONA_CREATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username ?? 'unknown';
        const rows = await callPersonaRows('organization.fn_persona_create', {
            p_tenant_id: orgId,
            p_key: p.key,
            p_name: p.name,
            p_description: p.description ?? null,
            p_statements: JSON.stringify(p.statements)
        });
        await authzAuditWriter.writePersonaEvent({
            tenantId: orgId,
            actorId,
            operation: 'create',
            personaId: rows[0].id,
            key: p.key,
            name: p.name
        });
        return rows[0];
    }

    @Component.Expose('Update')
    @Component.CheckPermissions(canManageAuthz)
    async update(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<PersonaUpdateParams>(
            params,
            PERSONA_UPDATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);

        // First confirm existence + system-managed status; fn_persona_update
        // skips the row silently if it's system-managed, so we'd otherwise
        // surface a misleading NotFound.
        const existing = await store.callMethod(
            'organization.fn_persona_check_attachable',
            {p_persona_id: p.id, p_tenant_id: orgId}
        );
        const existingRow = existing?.rows?.[0] as
            | {is_system_managed?: boolean}
            | undefined;
        if (!existingRow) throw RpcError.NotFound('persona');
        if (existingRow.is_system_managed) {
            throw RpcError.InvalidParams('cannot edit system-managed persona');
        }

        const clearDescription =
            Object.hasOwn(p, 'description') && p.description === null;
        const rows = await callPersonaRows('organization.fn_persona_update', {
            p_id: p.id,
            p_tenant_id: orgId,
            p_name: p.name ?? null,
            p_description: clearDescription ? null : (p.description ?? null),
            p_statements: p.statements ? JSON.stringify(p.statements) : null,
            p_clear_description: clearDescription
        });
        if (rows.length === 0) throw RpcError.NotFound('persona');
        await authzAuditWriter.writePersonaEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'update',
            personaId: rows[0].id,
            name: p.name,
            description: p.description,
            statements: p.statements
        });
        return rows[0];
    }

    @Component.Expose('Delete')
    @Component.CheckPermissions(canManageAuthz)
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<PersonaDeleteParams>(
            params,
            PERSONA_DELETE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const result = await store.callMethod(
            'organization.fn_persona_delete_safe',
            {p_id: p.id, p_tenant_id: orgId}
        );
        const summary = (result?.rows?.[0] as
            | {ref_count: number; deleted_count: number}
            | undefined) ?? {ref_count: 0, deleted_count: 0};
        if (summary.ref_count > 0) {
            throw RpcError.InvalidParams(
                `persona has ${summary.ref_count} assignment(s); detach them first`
            );
        }
        if (summary.deleted_count === 0) {
            throw RpcError.NotFound(
                'persona (or system-managed — cannot delete)'
            );
        }
        await authzAuditWriter.writePersonaEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'delete',
            personaId: p.id
        });
        return {success: true};
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
