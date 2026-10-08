import {scopedAutomationRepository} from '../../modules/nodeRed/scopedAutomationRepository';
import {
    scopedAutomationPrincipal,
    scopedAutomationService
} from '../../modules/nodeRed/scopedAutomationService';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SCOPED_AUTOMATION_CREATE_PARAMS_SCHEMA,
    SCOPED_AUTOMATION_DELETE_PARAMS_SCHEMA,
    SCOPED_AUTOMATION_DESCRIBE,
    SCOPED_AUTOMATION_ID_PARAMS_SCHEMA,
    SCOPED_AUTOMATION_LIST_PARAMS_SCHEMA,
    SCOPED_AUTOMATION_RUN_PARAMS_SCHEMA,
    SCOPED_AUTOMATION_UPDATE_PARAMS_SCHEMA,
    type ScopedAutomationCreateParams,
    type ScopedAutomationDeleteParams,
    type ScopedAutomationIdParams,
    type ScopedAutomationListParams,
    type ScopedAutomationRunParams,
    type ScopedAutomationUpdateParams
} from '../../types/api/scopedautomation';
import type CommandSender from '../CommandSender';
import {canAuthorDeviceScopedAutomation} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

export default class ScopedAutomationComponent extends Component<Config> {
    constructor() {
        super('scopedautomation', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SCOPED_AUTOMATION_DESCRIBE;
    }

    @Component.Expose('Create')
    @Component.NoPermissions
    async create(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ScopedAutomationCreateParams>(
            rawParams,
            SCOPED_AUTOMATION_CREATE_PARAMS_SCHEMA
        );
        if (
            !(await canAuthorDeviceScopedAutomation(sender, params.deviceIds))
        ) {
            throw RpcError.PermissionDenied(sender.isAuthenticated());
        }
        const tenantId = requireOrganizationId(sender);
        return await scopedAutomationService.create({
            id: params.idempotencyKey,
            definition: params,
            tenantId,
            sender
        });
    }

    @Component.Expose('List')
    @Component.NoPermissions
    async list(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ScopedAutomationListParams>(
            rawParams ?? {},
            SCOPED_AUTOMATION_LIST_PARAMS_SCHEMA
        );
        const tenantId = requireOrganizationId(sender);
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;
        const page = await scopedAutomationRepository.list(
            scopedAutomationPrincipal(sender, tenantId),
            limit,
            offset
        );
        return {
            ...page,
            limit,
            offset,
            has_more: offset + page.items.length < page.total
        };
    }

    @Component.Expose('Get')
    @Component.NoPermissions
    async get(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ScopedAutomationIdParams>(
            rawParams,
            SCOPED_AUTOMATION_ID_PARAMS_SCHEMA
        );
        const tenantId = requireOrganizationId(sender);
        const found = await scopedAutomationRepository.get(
            params.id,
            scopedAutomationPrincipal(sender, tenantId)
        );
        if (!found) throw RpcError.NotFound('scoped automation', params.id);
        return found;
    }

    @Component.Expose('Update')
    @Component.NoPermissions
    async update(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ScopedAutomationUpdateParams>(
            rawParams,
            SCOPED_AUTOMATION_UPDATE_PARAMS_SCHEMA
        );
        if (
            !(await canAuthorDeviceScopedAutomation(sender, params.deviceIds))
        ) {
            throw RpcError.PermissionDenied(sender.isAuthenticated());
        }
        return await scopedAutomationService.update({
            id: params.id,
            expectedRevision: params.expectedRevision,
            definition: params,
            tenantId: requireOrganizationId(sender),
            sender
        });
    }

    @Component.Expose('Delete')
    @Component.NoPermissions
    async delete(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ScopedAutomationDeleteParams>(
            rawParams,
            SCOPED_AUTOMATION_DELETE_PARAMS_SCHEMA
        );
        await scopedAutomationService.delete({
            ...params,
            tenantId: requireOrganizationId(sender),
            sender
        });
        return {id: params.id, deleted: true};
    }

    @Component.NoAudit
    @Component.Expose('Run')
    @Component.NoPermissions
    async run(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ScopedAutomationRunParams>(
            rawParams,
            SCOPED_AUTOMATION_RUN_PARAMS_SCHEMA
        );
        return await scopedAutomationService.run({
            ...params,
            tenantId: requireOrganizationId(sender)
        });
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
