import {
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import {jobAuthorityAllowsAllTargets} from '../../modules/jobs/control';
import {
    cancelJob,
    getJob,
    getJobControlContext,
    listActiveJobs,
    resumeJob
} from '../../modules/jobs/repository';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    JOB_CONTROL_PARAMS_SCHEMA,
    JOB_DESCRIBE,
    JOB_GET_PARAMS_SCHEMA,
    JOB_LIST_ACTIVE_PARAMS_SCHEMA,
    type OperationJobCapabilitiesResponse,
    type OperationJobControlParams,
    type OperationJobGetParams,
    type OperationJobListActiveParams,
    type OperationJobSnapshot
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

    private async controlledJob(
        p: OperationJobControlParams,
        sender: CommandSender
    ): Promise<{
        params: OperationJobControlParams;
        tenantId: string;
        job: OperationJobSnapshot;
    }> {
        const tenantId = requireOrganizationId(sender);
        const job = await getJob({
            tenantId,
            jobId: p.jobId,
            kind: p.kind
        });
        if (!job) throw RpcError.NotFound('job');
        return {params: p, tenantId, job};
    }

    private async capabilitiesFor(
        job: OperationJobSnapshot,
        tenantId: string,
        requester: CommandSender
    ): Promise<OperationJobCapabilitiesResponse> {
        const control = job.control;
        const context = await getJobControlContext({
            tenantId,
            jobId: job.id,
            kind: job.kind
        });
        const authorityCurrent = Boolean(
            context?.authority &&
                (await jobAuthorityAllowsAllTargets(
                    context.authority,
                    tenantId,
                    context.deviceIds
                ))
        );
        const operation =
            context?.authority?.kind === 'user'
                ? context.authority.operation
                : 'execute';
        const requesterCurrent = Boolean(
            context &&
                context.deviceIds.length > 0 &&
                (
                    await Promise.all(
                        context.deviceIds.map((deviceId) =>
                            canPerformComponentOperationAsync(
                                requester,
                                'devices',
                                operation,
                                deviceId
                            )
                        )
                    )
                ).every(isComponentPermissionAllowed)
        );
        const cancelable = Boolean(
            control &&
                requesterCurrent &&
                (control.state === 'stopped' ||
                    (control.state !== 'completed' &&
                        (control.queuedCount > 0 || control.claimedCount > 0)))
        );
        const resumable = Boolean(
            control &&
                authorityCurrent &&
                requesterCurrent &&
                control.state === 'stopped' &&
                control.stoppedCount > 0 &&
                control.unresolvedCount === 0
        );
        const authorityReason = authorityCurrent
            ? undefined
            : 'initiating authority is no longer current';
        return {
            kind: job.kind,
            inspect: {supported: true},
            cancel: cancelable
                ? {supported: true}
                : {
                      supported: false,
                      reason: requesterCurrent
                          ? 'no undispatched work can be stopped'
                          : 'requester no longer has authority for every target'
                  },
            resume: resumable
                ? {supported: true}
                : {
                      supported: false,
                      reason:
                          (!requesterCurrent
                              ? 'requester no longer has authority for every target'
                              : authorityReason) ??
                          (control?.unresolvedCount
                              ? 'job has dispatched work with an unknown outcome'
                              : 'no safely stopped undispatched work can be resumed')
                  }
        };
    }

    @Component.NoAudit
    @Component.Expose('Capabilities')
    @Component.CheckPermissions(canViewAuthz)
    async capabilities(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<OperationJobControlParams>(
            params,
            JOB_CONTROL_PARAMS_SCHEMA
        );
        const {job, tenantId} = await this.controlledJob(p, sender);
        return await this.capabilitiesFor(job, tenantId, sender);
    }

    @Component.Expose('Cancel')
    @Component.CheckPermissions(canViewAuthz)
    async cancel(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<OperationJobControlParams>(
            params,
            JOB_CONTROL_PARAMS_SCHEMA
        );
        const {job, tenantId} = await this.controlledJob(p, sender);
        const capabilities = await this.capabilitiesFor(job, tenantId, sender);
        if (!capabilities.cancel.supported) {
            throw RpcError.InvalidParams(
                capabilities.cancel.reason ?? 'job cannot be cancelled'
            );
        }
        await cancelJob({
            tenantId,
            jobId: job.id,
            kind: job.kind
        });
        const updated = await getJob({tenantId, jobId: job.id, kind: job.kind});
        if (!updated) throw RpcError.NotFound('job');
        return updated;
    }

    @Component.Expose('Resume')
    @Component.CheckPermissions(canViewAuthz)
    async resume(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<OperationJobControlParams>(
            params,
            JOB_CONTROL_PARAMS_SCHEMA
        );
        const {job, tenantId} = await this.controlledJob(p, sender);
        const capabilities = await this.capabilitiesFor(job, tenantId, sender);
        if (!capabilities.resume.supported) {
            throw RpcError.InvalidParams(
                capabilities.resume.reason ?? 'job cannot be resumed'
            );
        }
        await resumeJob({
            tenantId,
            jobId: job.id,
            kind: job.kind
        });
        const updated = await getJob({tenantId, jobId: job.id, kind: job.kind});
        if (!updated) throw RpcError.NotFound('job');
        return updated;
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
