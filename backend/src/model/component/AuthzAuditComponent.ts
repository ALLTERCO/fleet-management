import * as store from '../../modules/PostgresProvider';
import {buildListResponse} from '../../rpc/listResponse';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    AUTHZ_AUDIT_DESCRIBE,
    AUTHZ_AUDIT_LIST_PARAMS_SCHEMA,
    type AuthzAuditEntry,
    type AuthzAuditListParams
} from '../../types/api/authz_audit';
import type CommandSender from '../CommandSender';
import {canViewAuditLog} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function filterParams(orgId: string, p: AuthzAuditListParams) {
    return {
        p_tenant_id: orgId,
        p_from: p.from ?? null,
        p_to: p.to ?? null,
        p_actor_id: p.actorId ?? null,
        p_action: p.action ?? null,
        p_target_type: p.targetType ?? null,
        p_target_id: p.targetId ?? null
    };
}

// Read-only RPC over organization.authz_audit.
export default class AuthzAuditComponent extends Component<Config> {
    constructor() {
        super('authz_audit', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return AUTHZ_AUDIT_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canViewAuditLog)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<AuthzAuditListParams>(
            params,
            AUTHZ_AUDIT_LIST_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const limit = Math.min(p.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        const offset = p.offset ?? 0;
        const filters = filterParams(orgId, p);

        const countResult = await store.callMethod(
            'organization.fn_authz_audit_count',
            filters
        );
        // BIGINT comes back as string from node-postgres by default;
        // parse it. Safe up to 2^53 audit rows, which is way past any
        // realistic retention horizon.
        const raw = (
            countResult?.rows?.[0] as
                | {fn_authz_audit_count?: number | string}
                | undefined
        )?.fn_authz_audit_count;
        const total = typeof raw === 'string' ? Number(raw) : (raw ?? 0);

        const pageResult = await store.callMethod(
            'organization.fn_authz_audit_query',
            {...filters, p_limit: limit, p_offset: offset}
        );
        const rows = (pageResult?.rows ?? []) as AuthzAuditEntry[];

        return buildListResponse(rows, total, limit, offset);
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
