import {
    listStandingApprovals,
    revokeStandingApproval,
    type StandingApproval,
    type StandingApprovalScope
} from '../../modules/ai/mcpApprovals';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MCP_APPROVAL_DESCRIBE,
    MCP_APPROVAL_LIST_PARAMS_SCHEMA,
    MCP_APPROVAL_REVOKE_PARAMS_SCHEMA,
    type McpApprovalEntry,
    type McpApprovalListParams,
    type McpApprovalRevokeParams,
    type McpApprovalRevokeResult
} from '../../types/api/mcp_approval';
import type CommandSender from '../CommandSender';
import {canManageOrganizationSettings} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

const DEFAULT_LIMIT = 200;

// A remembered approval belongs to a person in an organization; a caller
// without both has none to see.
function personOf(
    sender: CommandSender
): {organizationId: string; userId: string} | undefined {
    const organizationId = sender.getOrganizationId();
    const userId = sender.getUserId();
    return organizationId && userId ? {organizationId, userId} : undefined;
}

function canReachOwnApprovals(sender: CommandSender): boolean {
    return personOf(sender) !== undefined;
}

function canList(
    sender: CommandSender,
    params: Partial<McpApprovalListParams> | undefined
): boolean {
    if (!canReachOwnApprovals(sender)) return false;
    return (
        params?.scope !== 'organization' ||
        canManageOrganizationSettings(sender)
    );
}

// Own approvals for everyone; the whole organization for its managers.
function revokeScopeFor(sender: CommandSender): StandingApprovalScope {
    const person = personOf(sender);
    if (!person) throw RpcError.Unauthorized();
    return canManageOrganizationSettings(sender)
        ? {organizationId: person.organizationId}
        : person;
}

function listScopeFor(
    sender: CommandSender,
    params: McpApprovalListParams
): StandingApprovalScope {
    const person = personOf(sender);
    if (!person) throw RpcError.Unauthorized();
    return params.scope === 'organization'
        ? {organizationId: person.organizationId}
        : person;
}

function toEntry(approval: StandingApproval): McpApprovalEntry {
    return {
        id: approval.id,
        userId: approval.userId,
        username: approval.username,
        method: approval.method,
        subject: approval.subject,
        scope: approval.scope,
        grantedAt: new Date(approval.grantedAtMs).toISOString(),
        expiresAt: new Date(approval.expiresAtMs).toISOString()
    };
}

// The "stop asking" answers given to AI agents, visible and revocable.
export default class McpApprovalComponent extends Component<Config> {
    constructor() {
        super('mcp_approval', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return MCP_APPROVAL_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canList)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<McpApprovalListParams>(
            params ?? {},
            MCP_APPROVAL_LIST_PARAMS_SCHEMA
        );
        const all = await listStandingApprovals(listScopeFor(sender, p));
        const limit = p.limit ?? DEFAULT_LIMIT;
        const offset = p.offset ?? 0;
        return buildListResponse(
            all.slice(offset, offset + limit).map(toEntry),
            all.length,
            limit,
            offset
        );
    }

    @Component.Expose('Revoke')
    @Component.CheckPermissions(canReachOwnApprovals)
    async revoke(
        params: unknown,
        sender: CommandSender
    ): Promise<McpApprovalRevokeResult> {
        const p = validateOrThrow<McpApprovalRevokeParams>(
            params,
            MCP_APPROVAL_REVOKE_PARAMS_SCHEMA
        );
        return {
            revoked: await revokeStandingApproval(p.id, revokeScopeFor(sender))
        };
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
