import {envBool, envInt} from '../../config/envReader';
import {tuning} from '../../config/tuning';
import {authzAuditWriter} from '../../modules/authz/audit';
import {assertDeviceUpdateAccess} from '../../modules/authz/evaluator';
import {
    computeHa1,
    generatePassword
} from '../../modules/credential/passwordGen';
import {createCredentialJob} from '../../modules/jobs/repository';
import * as store from '../../modules/PostgresProvider';
import {
    classifyByCode,
    withOutcomeCounter
} from '../../modules/rpcOutcomeCounter';
import {
    decryptStringSecret,
    encryptStringSecret
} from '../../modules/secretCrypto';
import {runBoundedParallel} from '../../modules/util/runBoundedParallel';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CREDENTIAL_CLEAR_PARAMS_SCHEMA,
    CREDENTIAL_CONFIRM_OLD_PARAMS_SCHEMA,
    CREDENTIAL_DESCRIBE,
    CREDENTIAL_GET_PARAMS_SCHEMA,
    CREDENTIAL_LIST_FAILED_PARAMS_SCHEMA,
    CREDENTIAL_LIST_PARAMS_SCHEMA,
    CREDENTIAL_LIST_PUSHES_PARAMS_SCHEMA,
    CREDENTIAL_PUSH_STATUS_PARAMS_SCHEMA,
    CREDENTIAL_RETRY_PARAMS_SCHEMA,
    CREDENTIAL_REVEAL_PARAMS_SCHEMA,
    CREDENTIAL_ROTATE_PARAMS_SCHEMA,
    CREDENTIAL_SET_PARAMS_SCHEMA,
    type CredentialClearParams,
    type CredentialConfirmOldParams,
    type CredentialGetParams,
    type CredentialJobResponse,
    type CredentialListFailedParams,
    type CredentialListParams,
    type CredentialListPushesParams,
    type CredentialPushRow,
    type CredentialPushStatusParams,
    type CredentialRetryParams,
    type CredentialRevealParams,
    type CredentialRotateParams,
    type CredentialSetParams,
    type DeviceCredentialResponse
} from '../../types/api/credential';
import {DOMAIN_ERRORS} from '../../types/api/errors';
import type CommandSender from '../CommandSender';
import {canManageAuthz, canViewAuthz} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

// AAD for password_encrypted at-rest binding (same in credential_pushes and
// device_credentials so the worker can copy the blob without re-encrypting).
function passwordAad(tenantId: string, deviceId: string): string {
    return `device_credentials:tenant:${tenantId}:device:${deviceId}`;
}

const SET_METRIC = 'credential_set_total';
const ROTATE_METRIC = 'credential_rotate_total';
const CLEAR_METRIC = 'credential_clear_total';

// 'stage_failed' fires only when the stage RPC returned no push id
// (InvalidParams). Auth failures and platform errors keep their own labels
// so 'stage_failed' stops doubling as a catch-all.
const UNAUTHORIZED_CODE = -32000;
const INVALID_PARAMS_CODE = -32602;

const STAGE_OUTCOME_BY_CODE: Record<number, string> = {
    [UNAUTHORIZED_CODE]: 'unauthorized',
    [DOMAIN_ERRORS.OrgScopeRequired.code]: 'unauthorized',
    [INVALID_PARAMS_CODE]: 'stage_failed'
};

const classifyStageFailure = classifyByCode(STAGE_OUTCOME_BY_CODE);

function revealRateLimitPerDay(): number {
    return envInt('FM_CREDENTIAL_REVEAL_PER_ADMIN_PER_DAY', 30, 1);
}
function revealRequiresReauth(): boolean {
    return envBool('FM_CREDENTIAL_REVEAL_REQUIRE_REAUTH', true);
}

async function callCredRows(
    fn: string,
    params: Record<string, unknown>
): Promise<DeviceCredentialResponse[]> {
    const result = await store.callMethod(fn, params);
    return (result?.rows ?? []) as DeviceCredentialResponse[];
}

export default class CredentialComponent extends Component<Config> {
    constructor() {
        super('credential', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return CREDENTIAL_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canViewAuthz)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialListParams>(
            params,
            CREDENTIAL_LIST_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const limit = p.limit ?? 100;
        const offset = p.offset ?? 0;
        const rows = await callCredRows('organization.fn_credential_list', {
            p_tenant_id: orgId,
            p_device_id: p.deviceId ?? null,
            p_status: p.status ?? null,
            p_limit: limit,
            p_offset: offset
        });
        return buildListResponse(rows, rows.length, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canViewAuthz)
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialGetParams>(
            params,
            CREDENTIAL_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await callCredRows('organization.fn_credential_get', {
            p_tenant_id: orgId,
            p_device_id: p.deviceId
        });
        if (rows.length === 0) throw RpcError.NotFound('device_credential');
        return rows[0];
    }

    @Component.Expose('Reveal')
    @Component.CheckPermissions(canManageAuthz)
    async reveal(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialRevealParams>(
            params,
            CREDENTIAL_REVEAL_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        const limit = revealRateLimitPerDay();
        const countResult = await store.callMethod(
            'organization.fn_credential_reveal_count_24h',
            {p_tenant_id: orgId, p_actor_id: actorId}
        );
        const used =
            (
                countResult?.rows?.[0] as
                    | {fn_credential_reveal_count_24h?: number}
                    | undefined
            )?.fn_credential_reveal_count_24h ?? 0;
        if (used >= limit) {
            throw RpcError.InvalidParams(
                `reveal rate limit exceeded: ${limit}/24h. Wait or raise FM_CREDENTIAL_REVEAL_PER_ADMIN_PER_DAY.`
            );
        }

        if (revealRequiresReauth() && !sender.isMfaPresent()) {
            throw RpcError.InvalidParams(
                're-authentication required (FM_CREDENTIAL_REVEAL_REQUIRE_REAUTH=true)'
            );
        }

        const pwResult = await store.callMethod(
            'organization.fn_credential_get_password',
            {p_tenant_id: orgId, p_device_id: p.deviceId}
        );
        const rows = (pwResult?.rows ?? []) as Array<{
            password_encrypted: string;
            realm: string;
            username: string;
        }>;
        if (rows.length === 0) throw RpcError.NotFound('device_credential');

        // Audit before decrypt so a decrypt failure still burns rate-limit quota.
        await store.callMethod('organization.fn_credential_reveal_audit', {
            p_tenant_id: orgId,
            p_actor_id: actorId,
            p_device_id: p.deviceId,
            p_justification: p.justification ?? null
        });
        const password = decryptStringSecret(rows[0].password_encrypted, {
            additionalData: passwordAad(orgId, p.deviceId)
        });

        await authzAuditWriter.writeCredentialEvent({
            tenantId: orgId,
            actorId,
            operation: 'reveal',
            credentialKind: 'device_credential',
            targetId: p.deviceId,
            hasJustification: !!p.justification
        });
        return {
            deviceId: p.deviceId,
            username: rows[0].username,
            realm: rows[0].realm,
            password
        };
    }

    // Queue a credential push via fn_credential_stage_push. Set/Rotate pass
    // a real password; Clear passes nulls. device_credentials is not
    // touched until the worker confirms the device.
    private async stagePush(
        orgId: string,
        jobId: string,
        deviceId: string,
        password: string,
        actorId: string
    ): Promise<number> {
        const newHa1 = computeHa1('admin', deviceId, password);
        const encrypted = encryptStringSecret(password, {
            additionalData: passwordAad(orgId, deviceId)
        });
        return this.#stagePushRaw(
            orgId,
            jobId,
            deviceId,
            newHa1,
            encrypted,
            actorId
        );
    }

    // null ha1 + null password -> worker sends Shelly.SetAuth with ha1=null.
    private async stagePushClear(
        orgId: string,
        jobId: string,
        deviceId: string,
        actorId: string
    ): Promise<number> {
        return this.#stagePushRaw(orgId, jobId, deviceId, null, null, actorId);
    }

    async #stagePushRaw(
        orgId: string,
        jobId: string,
        deviceId: string,
        ha1NewHex: string | null,
        passwordEncrypted: string | null,
        actorId: string
    ): Promise<number> {
        const result = await store.callMethod(
            'organization.fn_credential_stage_push',
            {
                p_job_id: jobId,
                p_tenant_id: orgId,
                p_device_id: deviceId,
                p_ha1_new_hex: ha1NewHex,
                p_password_encrypted: passwordEncrypted,
                p_requested_by: actorId
            }
        );
        const row = result?.rows?.[0] as
            | {fn_credential_stage_push?: number}
            | undefined;
        if (!row?.fn_credential_stage_push) {
            throw RpcError.InvalidParams(
                `stagePush returned no push id for device ${deviceId}`
            );
        }
        return row.fn_credential_stage_push;
    }

    @Component.Expose('Set')
    @Component.CheckPermissions(canManageAuthz)
    async set(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialSetParams>(
            params,
            CREDENTIAL_SET_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: SET_METRIC,
            classify: classifyStageFailure,
            run: () => this.#setStaged(p, sender)
        });
    }

    async #setStaged(p: CredentialSetParams, sender: CommandSender) {
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        // Per-device authz. canManageAuthz alone lets a tenant admin
        // target any deviceId. Global provider support bypasses; everyone else must
        // hold devices:update on the specific device.
        await assertDeviceUpdateAccess(sender, [p.deviceId]);

        const jobId = await createCredentialJob({
            tenantId: orgId,
            mode: 'set',
            target: {deviceIds: [p.deviceId]},
            createdBy: actorId
        });
        const pushId = await this.stagePush(
            orgId,
            jobId,
            p.deviceId,
            p.password,
            actorId
        );

        // No password fingerprint in any device-credential audit (set or
        // rotate): even generated passwords share key-stretching weakness with
        // operator-chosen ones, so a SHA-256 in audit becomes an offline
        // brute-force target if the audit DB leaks.
        await authzAuditWriter.writeCredentialEvent({
            tenantId: orgId,
            actorId,
            operation: 'set',
            credentialKind: 'device_credential',
            targetId: p.deviceId,
            jobId
        });
        return {
            jobId,
            pushId,
            deviceId: p.deviceId,
            username: 'admin',
            realm: p.deviceId,
            password: p.password
        };
    }

    @Component.Expose('Rotate')
    @Component.CheckPermissions(canManageAuthz)
    async rotate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialRotateParams>(
            params,
            CREDENTIAL_ROTATE_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: ROTATE_METRIC,
            classify: classifyStageFailure,
            run: () => this.#rotateStaged(p, sender)
        });
    }

    async #rotateStaged(p: CredentialRotateParams, sender: CommandSender) {
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        const target = p.target;
        const ids = (target.deviceIds ?? []).slice();
        if (ids.length === 0) {
            throw RpcError.InvalidParams(
                'rotate currently requires explicit deviceIds — group/tag expansion lands in PR follow-up'
            );
        }

        await assertDeviceUpdateAccess(sender, ids);

        const includeFlagged = p.includeFlagged === true;
        if (!includeFlagged) {
            const result = await store.callMethod(
                'organization.fn_credential_list_flagged_ids',
                {p_tenant_id: orgId, p_device_ids: ids}
            );
            const flagged = (result?.rows ?? []) as Array<{device_id: string}>;
            const flaggedSet = new Set(flagged.map((f) => f.device_id));
            const filtered = ids.filter((id) => !flaggedSet.has(id));
            if (filtered.length === 0) {
                throw RpcError.InvalidParams(
                    'all targeted devices are flagged; pass includeFlagged=true to rotate them anyway'
                );
            }
            ids.length = 0;
            ids.push(...filtered);
        }

        const jobId = await createCredentialJob({
            tenantId: orgId,
            mode: 'rotate',
            target: {deviceIds: ids},
            createdBy: actorId
        });

        // Distinct devices take distinct advisory locks, so staging in
        // parallel is safe; failFast keeps the first-error-throws contract.
        const settled = await runBoundedParallel({
            tasks: ids,
            run: async (id) => {
                const password = generatePassword();
                const pushId = await this.stagePush(
                    orgId,
                    jobId,
                    id,
                    password,
                    actorId
                );
                return {deviceId: id, password, pushId};
            },
            concurrency: tuning.deviceIngress.credentialStageConcurrency,
            perTaskTimeoutMs: tuning.deviceIngress.credentialStageTimeoutMs,
            label: 'credential-rotate-stage',
            failFast: true
        });
        const results = settled.map((r) => {
            if (r.status === 'rejected') throw r.reason;
            return r.value;
        });

        await authzAuditWriter.writeCredentialEvent({
            tenantId: orgId,
            actorId,
            operation: 'rotate',
            credentialKind: 'device_credential',
            targetId: 'bulk',
            jobId,
            deviceCount: ids.length
        });
        return {jobId, results};
    }

    @Component.Expose('Clear')
    @Component.CheckPermissions(canManageAuthz)
    async clear(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialClearParams>(
            params,
            CREDENTIAL_CLEAR_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: CLEAR_METRIC,
            classify: classifyStageFailure,
            run: () => this.#clearStaged(p, sender)
        });
    }

    async #clearStaged(p: CredentialClearParams, sender: CommandSender) {
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        const ids = p.target.deviceIds ?? [];
        if (ids.length === 0) {
            throw RpcError.InvalidParams(
                'clear currently requires explicit deviceIds'
            );
        }
        await assertDeviceUpdateAccess(sender, ids);

        // Clear runs through the same job + push pipeline as Set/Rotate
        // (worker sends Shelly.SetAuth ha1=null, fn_credential_finalize_cleared
        // DELETEs the device_credentials row). Results carry the staged
        // push id; operator polls Credential.PushStatus for outcome.
        const jobId = await createCredentialJob({
            tenantId: orgId,
            mode: 'clear',
            target: {deviceIds: ids},
            createdBy: actorId
        });
        const results: Array<{deviceId: string; pushId: number}> = [];
        for (const id of ids) {
            const pushId = await this.stagePushClear(orgId, jobId, id, actorId);
            results.push({deviceId: id, pushId});
        }

        await authzAuditWriter.writeCredentialEvent({
            tenantId: orgId,
            actorId,
            operation: 'clear',
            credentialKind: 'device_credential',
            targetId: 'bulk',
            jobId,
            deviceCount: ids.length
        });
        return {jobId, results};
    }

    @Component.Expose('Retry')
    @Component.CheckPermissions(canManageAuthz)
    async retry(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialRetryParams>(
            params,
            CREDENTIAL_RETRY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        const result = await store.callMethod(
            'organization.fn_credential_retry_push',
            {p_push_id: p.pushId, p_tenant_id: orgId}
        );
        const rows = (result?.rows ?? []) as Array<{
            id: number;
            job_id: string;
            device_id: string;
        }>;
        if (rows.length === 0) throw RpcError.NotFound('credential_push');

        await authzAuditWriter.writeCredentialEvent({
            tenantId: orgId,
            actorId,
            operation: 'retry',
            credentialKind: 'device_credential',
            targetId: rows[0].device_id,
            pushId: p.pushId,
            jobId: rows[0].job_id
        });
        return {success: true, pushId: rows[0].id};
    }

    @Component.Expose('ConfirmOld')
    @Component.CheckPermissions(canManageAuthz)
    async confirmOld(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialConfirmOldParams>(
            params,
            CREDENTIAL_CONFIRM_OLD_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        const result = await store.callMethod(
            'organization.fn_credential_confirm_old',
            {p_push_id: p.pushId, p_tenant_id: orgId}
        );
        const rows = (result?.rows ?? []) as Array<{
            device_id: string;
            ha1_old_hex: string | null;
        }>;
        if (rows.length === 0) throw RpcError.NotFound('credential_push');

        if (rows[0].ha1_old_hex) {
            await store.callMethod(
                'organization.fn_credential_rollback_to_old',
                {
                    p_tenant_id: orgId,
                    p_device_id: rows[0].device_id,
                    p_ha1_old_hex: rows[0].ha1_old_hex
                }
            );
        }
        await authzAuditWriter.writeCredentialEvent({
            tenantId: orgId,
            actorId,
            operation: 'confirm_old',
            credentialKind: 'device_credential',
            targetId: rows[0].device_id
        });
        return {success: true};
    }

    @Component.NoAudit
    @Component.Expose('ListFailed')
    @Component.CheckPermissions(canViewAuthz)
    async listFailed(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialListFailedParams>(
            params,
            CREDENTIAL_LIST_FAILED_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const limit = p.limit ?? 100;
        const offset = p.offset ?? 0;
        const rows = await callCredRows(
            'organization.fn_credential_list_failed',
            {p_tenant_id: orgId, p_limit: limit, p_offset: offset}
        );
        return buildListResponse(rows, rows.length, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('PushStatus')
    @Component.CheckPermissions(canViewAuthz)
    async pushStatus(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialPushStatusParams>(
            params,
            CREDENTIAL_PUSH_STATUS_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const jobResult = await store.callMethod(
            'organization.fn_credential_job_status',
            {p_job_id: p.jobId, p_tenant_id: orgId}
        );
        const jobs = (jobResult?.rows ?? []) as CredentialJobResponse[];
        if (jobs.length === 0) throw RpcError.NotFound('credential_job');
        const rowsResult = await store.callMethod(
            'organization.fn_credential_push_rows_by_job',
            {p_job_id: p.jobId, p_tenant_id: orgId}
        );
        const rows = (rowsResult?.rows ?? []) as CredentialPushRow[];
        return {job: jobs[0], rows};
    }

    @Component.NoAudit
    @Component.Expose('ListPushes')
    @Component.CheckPermissions(canViewAuthz)
    async listPushes(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CredentialListPushesParams>(
            params,
            CREDENTIAL_LIST_PUSHES_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const limit = p.limit ?? 100;
        const offset = p.offset ?? 0;
        const result = await store.callMethod(
            'organization.fn_credential_list_pushes',
            {
                p_tenant_id: orgId,
                p_device_id: p.deviceId ?? null,
                p_job_id: p.jobId ?? null,
                p_status: p.status ?? null,
                p_limit: limit,
                p_offset: offset
            }
        );
        const rows = (result?.rows ?? []) as CredentialPushRow[];
        return buildListResponse(rows, rows.length, limit, offset);
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
