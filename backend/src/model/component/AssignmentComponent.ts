import {
    createAssignmentGrant,
    deleteAssignmentGrant
} from '../../modules/authz/admin';
import {loadAuthzConfig} from '../../modules/authz/config';
import {assertScopeRefsBelongToOrg} from '../../modules/authz/resources/ScopeResourceValidator';
import {
    isExplicitScope,
    SCOPE_NOT_EXPLICIT_MESSAGE
} from '../../modules/authz/scopeGuard';
import * as store from '../../modules/PostgresProvider';
import {assertTargetInTenant} from '../../modules/user/tenantGate';
import {ensureZitadelManagement} from '../../modules/user/validation';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ASSIGNMENT_CREATE_PARAMS_SCHEMA,
    ASSIGNMENT_DELETE_PARAMS_SCHEMA,
    ASSIGNMENT_DESCRIBE,
    ASSIGNMENT_LIST_FOR_PERSONA_PARAMS_SCHEMA,
    ASSIGNMENT_LIST_FOR_RESOURCE_PARAMS_SCHEMA,
    ASSIGNMENT_LIST_FOR_SUBJECT_PARAMS_SCHEMA,
    ASSIGNMENT_LIST_UNUSED_PARAMS_SCHEMA,
    type AssignmentCreateParams,
    type AssignmentDeleteParams,
    type AssignmentListForPersonaParams,
    type AssignmentListForResourceParams,
    type AssignmentListForSubjectParams,
    type AssignmentListUnusedParams,
    type AssignmentResponse,
    SCOPE_SCHEMA
} from '../../types/api/assignment';
import type CommandSender from '../CommandSender';
import {canManageAuthz, canReadPolicies} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

// The probe value must match how scope values are STORED on the wire (e.g.
// alert rules have numeric entity ids, but alert_ids carries strings). The
// schema is the one home for that, so derive instead of re-declaring.
function scopeValuesAreNumeric(scopeKey: string): boolean {
    const property = SCOPE_SCHEMA.properties?.[scopeKey] as
        | {items?: {type?: string}}
        | undefined;
    return property?.items?.type === 'integer';
}

function scopeRoute(scopeKey: string): {
    scopeKey: string;
    numericScopeValues: boolean;
} {
    return {scopeKey, numericScopeValues: scopeValuesAreNumeric(scopeKey)};
}

// Maps an external resourceType to its JSONB scope key.
const RESOURCE_TYPE_TO_SCOPE: Record<
    AssignmentListForResourceParams['resourceType'],
    {scopeKey: string; numericScopeValues: boolean}
> = {
    dashboard: scopeRoute('dashboard_ids'),
    location: scopeRoute('location_ids'),
    group: scopeRoute('device_group_ids'),
    device: scopeRoute('device_ids'),
    tag: scopeRoute('device_tags'),
    plugin: scopeRoute('plugin_keys'),
    waiting_room: scopeRoute('waiting_room_ids'),
    configuration: scopeRoute('configuration_keys'),
    report: scopeRoute('report_ids'),
    organization: scopeRoute('organization_ids'),
    alert: scopeRoute('alert_ids'),
    notification: scopeRoute('notification_ids'),
    integration: scopeRoute('integration_keys'),
    automation: scopeRoute('automation_ids'),
    action: scopeRoute('actions')
};

async function listAssignmentRows(
    fn: string,
    params: Record<string, unknown>
): Promise<AssignmentResponse[]> {
    const result = await store.callMethod(fn, params);
    return (result?.rows ?? []) as AssignmentResponse[];
}

export default class AssignmentComponent extends Component<Config> {
    constructor() {
        super('assignment', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return ASSIGNMENT_DESCRIBE;
    }

    @Component.Expose('Create')
    @Component.CheckPermissions(canManageAuthz)
    async create(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AssignmentCreateParams>(
            params,
            ASSIGNMENT_CREATE_PARAMS_SCHEMA
        );
        if (!isExplicitScope(p.scope)) {
            throw RpcError.InvalidParams(SCOPE_NOT_EXPLICIT_MESSAGE);
        }
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        // user_group subjects must exist in this tenant.
        if (p.subjectType === 'user_group') {
            const groupResult = await store.callMethod(
                'organization.fn_user_group_exists',
                {p_id: p.subjectId, p_tenant_id: orgId}
            );
            const exists =
                (
                    groupResult?.rows?.[0] as
                        | {fn_user_group_exists?: boolean}
                        | undefined
                )?.fn_user_group_exists === true;
            if (!exists) throw RpcError.NotFound('user_group');
        }
        // User subjects must belong to this tenant, including metadata-owned
        // service users that do not carry a normal resourceOwner.
        if (p.subjectType === 'user') {
            // ensureZitadelManagement before the gate so the DEV/misconfigured
            // fail-open path (userBelongsToTenant returns true unconditionally
            // when !isConfigured) can't be used to attach a persona to a
            // foreign userId.
            ensureZitadelManagement();
            try {
                await assertTargetInTenant(sender, p.subjectId, orgId);
            } catch (error) {
                if (!(error instanceof RpcError)) throw error;
                throw RpcError.NotFound('user not found in this tenant');
            }
        }
        await assertScopeRefsBelongToOrg({orgId, scope: p.scope});

        return createAssignmentGrant({
            tenantId: orgId,
            actorId,
            grantor: sender,
            subjectType: p.subjectType,
            subjectId: p.subjectId,
            personaId: p.personaId,
            scope: p.scope,
            metadata: {
                reason: p.reason,
                comment: p.comment,
                expiresAt: p.expiresAt
            }
        });
    }

    @Component.Expose('Delete')
    @Component.CheckPermissions(canManageAuthz)
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AssignmentDeleteParams>(
            params,
            ASSIGNMENT_DELETE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        return deleteAssignmentGrant({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            grantor: sender,
            assignmentId: p.id
        });
    }

    @Component.NoAudit
    @Component.Expose('ListForSubject')
    @Component.CheckPermissions(canReadPolicies)
    async listForSubject(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AssignmentListForSubjectParams>(
            params,
            ASSIGNMENT_LIST_FOR_SUBJECT_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await listAssignmentRows(
            'organization.fn_assignment_list_for_subject',
            {
                p_tenant_id: orgId,
                p_subject_type: p.subjectType,
                p_subject_id: p.subjectId
            }
        );
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    @Component.NoAudit
    @Component.Expose('ListForPersona')
    @Component.CheckPermissions(canReadPolicies)
    async listForPersona(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AssignmentListForPersonaParams>(
            params,
            ASSIGNMENT_LIST_FOR_PERSONA_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await listAssignmentRows(
            'organization.fn_assignment_list_for_persona',
            {p_tenant_id: orgId, p_persona_id: p.personaId}
        );
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    @Component.NoAudit
    @Component.Expose('ListForResource')
    @Component.CheckPermissions(canReadPolicies)
    async listForResource(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AssignmentListForResourceParams>(
            params,
            ASSIGNMENT_LIST_FOR_RESOURCE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const route = RESOURCE_TYPE_TO_SCOPE[p.resourceType];
        if (!route) {
            throw RpcError.InvalidParams(
                `unknown resourceType: ${p.resourceType}`
            );
        }
        let idValue: number | string;
        if (route.numericScopeValues) {
            const n = Number(p.resourceId);
            if (!Number.isInteger(n) || n < 1) {
                throw RpcError.InvalidParams(
                    `resourceId for ${p.resourceType} must be a positive integer`
                );
            }
            idValue = n;
        } else {
            idValue = String(p.resourceId);
        }
        const scopeProbe = JSON.stringify({[route.scopeKey]: [idValue]});
        const rows = await listAssignmentRows(
            'organization.fn_assignment_list_for_resource',
            {p_tenant_id: orgId, p_scope_probe: scopeProbe}
        );
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    @Component.NoAudit
    @Component.Expose('ListUnused')
    @Component.CheckPermissions(canReadPolicies)
    async listUnused(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AssignmentListUnusedParams>(
            params,
            ASSIGNMENT_LIST_UNUSED_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const days = p.thresholdDays ?? loadAuthzConfig().unusedThresholdDays;
        const rows = await listAssignmentRows(
            'organization.fn_assignment_list_unused',
            {p_tenant_id: orgId, p_threshold_days: days}
        );
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
