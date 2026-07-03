import {getJob, listActiveJobs} from '../../modules/jobs/repository';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    JOB_DESCRIBE,
    JOB_GET_PARAMS_SCHEMA,
    JOB_LIST_ACTIVE_PARAMS_SCHEMA,
    type OperationJobGetParams,
    type OperationJobListActiveParams
} from '../../types/api/job';
import type CommandSender from '../CommandSender';
import {canViewAuthz} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

export default class JobComponent extends Component<Config> {
    constructor() {
        super('job', {
            auto_apply_config: false,
            set_config_methods: false,
            viewer_visible: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return JOB_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('ListActive')
    @Component.CheckPermissions(canViewAuthz)
    async listActive(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<OperationJobListActiveParams>(
            params ?? {},
            JOB_LIST_ACTIVE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const items = await listActiveJobs({
            tenantId: orgId,
            kinds: p.kinds,
            limit: p.limit
        });
        return buildListResponse(items, items.length, p.limit ?? 50, 0);
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canViewAuthz)
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<OperationJobGetParams>(
            params,
            JOB_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const job = await getJob({
            tenantId: orgId,
            jobId: p.jobId,
            kind: p.kind
        });
        if (!job) throw RpcError.NotFound('job');
        return job;
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
