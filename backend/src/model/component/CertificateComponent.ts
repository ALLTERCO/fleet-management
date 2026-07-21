import {envInt} from '../../config/envReader';
import {authzAuditWriter} from '../../modules/authz/audit';
import {assertDeviceUpdateAccess} from '../../modules/authz/evaluator';
import {
    extractCsrSubjectCn,
    FmCaUnavailableError,
    isFmCaAvailable,
    issueDeviceCert,
    signValidatedCsr
} from '../../modules/certificate/fmCaSigner';
import {parseCertificateChain} from '../../modules/certificate/parser';
import {preflight} from '../../modules/certificate/preflight';
import {resolvePushTargetDevices} from '../../modules/certificate/targetResolver';
import * as EventDistributor from '../../modules/EventDistributor';
import {
    createCertificateJob,
    enqueueCertificateTargets
} from '../../modules/jobs/repository';
import * as store from '../../modules/PostgresProvider';
import {
    classifyByCode,
    rpcErrorCode,
    withOutcomeCounter
} from '../../modules/rpcOutcomeCounter';
import {
    decryptStringSecret,
    encryptStringSecret
} from '../../modules/secretCrypto';
import {buildListResponse, totalFromRows} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CERTIFICATE_DELETE_PARAMS_SCHEMA,
    CERTIFICATE_DESCRIBE,
    CERTIFICATE_EXPORT_PARAMS_SCHEMA,
    CERTIFICATE_GET_ISSUE_DEFAULTS_PARAMS_SCHEMA,
    CERTIFICATE_GET_PARAMS_SCHEMA,
    CERTIFICATE_IMPORT_PARAMS_SCHEMA,
    CERTIFICATE_ISSUE_DEVICE_PARAMS_SCHEMA,
    CERTIFICATE_LIST_PARAMS_SCHEMA,
    CERTIFICATE_LIST_PUSHES_PARAMS_SCHEMA,
    CERTIFICATE_PREFLIGHT_PUSH_PARAMS_SCHEMA,
    CERTIFICATE_PUSH_STATUS_PARAMS_SCHEMA,
    CERTIFICATE_PUSH_TO_DEVICES_PARAMS_SCHEMA,
    CERTIFICATE_SET_GROUPS_PARAMS_SCHEMA,
    CERTIFICATE_SET_TAGS_PARAMS_SCHEMA,
    CERTIFICATE_SIGN_CSR_PARAMS_SCHEMA,
    CERTIFICATE_UPDATE_PARAMS_SCHEMA,
    type CertificateDeleteParams,
    type CertificateExportParams,
    type CertificateGetIssueDefaultsParams,
    type CertificateGetParams,
    type CertificateImportParams,
    type CertificateIssueDeviceParams,
    type CertificateListParams,
    type CertificateListPushesParams,
    type CertificatePreflightPushParams,
    type CertificatePushRow,
    type CertificatePushStatusParams,
    type CertificatePushToDevicesParams,
    type CertificateResponse,
    type CertificateSetGroupsParams,
    type CertificateSetGroupsResponse,
    type CertificateSetTagsParams,
    type CertificateSetTagsResponse,
    type CertificateSignCsrParams,
    type CertificateUpdateParams
} from '../../types/api/certificate';
import {DOMAIN_ERRORS} from '../../types/api/errors';
import type CommandSender from '../CommandSender';
import {canManageAuthz, canViewAuthz} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

// AAD for private_key_encrypted at-rest binding.
function privateKeyAad(tenantId: string, fingerprint: string): string {
    return `certificates:tenant:${tenantId}:fp:${fingerprint}`;
}

// Ingress trusts an FM-CA cert's O to route the device to its tenant, so a
// cert FM signs must carry O = the owning org and nothing else. The CSR-sign
// path copies the device's CSR subject verbatim, where O is attacker-chosen —
// reject any mismatch here, before the cert is stored or trusted.
function assertCertSubjectOrgMatches(
    meta: {metadata: {subject_o: string | null}},
    orgId: string
): void {
    const certOrg = meta.metadata.subject_o;
    if (certOrg !== null && certOrg !== orgId) {
        throw RpcError.InvalidParams(
            'certificate subject O must match the owning organization'
        );
    }
}

const SIGN_CSR_METRIC = 'certificate_sign_csr_total';
const SET_TAGS_METRIC = 'certificate_set_tags_total';
const SET_GROUPS_METRIC = 'certificate_set_groups_total';

// ServiceUnavailable here only appears via RpcError.Unavailable('fm-ca', …);
// SignCsr does not call any other unavailable surface in its hot path.
function classifySignCsr(err: unknown): string {
    const code = rpcErrorCode(err);
    if (code === DOMAIN_ERRORS.ServiceUnavailable.code)
        return 'fm_ca_unavailable';
    if (code === DOMAIN_ERRORS.ResourceNotFound.code) return 'subject_mismatch';
    return 'csr_invalid';
}

// 'invalid' fires when the cert id doesn't resolve or the request payload
// fails validation. DB outages and other unknowns surface as 'error' so a
// platform incident doesn't masquerade as a user error.
const SET_TAGS_OUTCOME_BY_CODE: Record<number, string> = {
    [DOMAIN_ERRORS.ResourceNotFound.code]: 'invalid',
    [DOMAIN_ERRORS.ValidationFailed.code]: 'invalid',
    [-32602]: 'invalid'
};

const classifySetTags = classifyByCode(SET_TAGS_OUTCOME_BY_CODE);

// 'cross_tenant' fires only on a cross-org reference rejection; everything
// else (missing cert → 'invalid', DB → 'error') stays honest.
const SET_GROUPS_OUTCOME_BY_CODE: Record<number, string> = {
    [DOMAIN_ERRORS.CrossOrgReference.code]: 'cross_tenant',
    [DOMAIN_ERRORS.ResourceNotFound.code]: 'invalid',
    [DOMAIN_ERRORS.ValidationFailed.code]: 'invalid',
    [-32602]: 'invalid'
};

const classifySetGroups = classifyByCode(SET_GROUPS_OUTCOME_BY_CODE);

async function callCertRows(
    fn: string,
    params: Record<string, unknown>
): Promise<CertificateResponse[]> {
    const result = await store.callMethod(fn, params);
    return (result?.rows ?? []) as CertificateResponse[];
}

// List fns emit COUNT(*) OVER() AS total_count on every row.
type Counted<T> = T & {total_count?: number};

// Strip total_count so items keep their wire shape.
function withoutTotalCount<T>(rows: Array<Counted<T>>): T[] {
    return rows.map(({total_count: _, ...item}) => item as T);
}

export default class CertificateComponent extends Component<Config> {
    constructor() {
        super('certificate', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return CERTIFICATE_DESCRIBE;
    }

    // Shelly device IDs are case-insensitive in the wild (mDNS, MQTT, and
    // Shelly Cloud all treat shellyplus1pm-AABBCC and -aabbcc as the same
    // device). Compare lowercased so operator-typed CSRs match stored IDs.
    async #assertDeviceBelongsToOrg(
        orgId: string,
        shellyId: string
    ): Promise<void> {
        const rows = (await store.queryRows(
            `SELECT 1
               FROM device.list
              WHERE organization_id = $1
                AND LOWER(external_id) = LOWER($2)
              LIMIT 1`,
            [orgId, shellyId]
        )) as unknown[];
        if (rows.length === 0) throw RpcError.NotFound('device');
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canViewAuthz)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateListParams>(
            params,
            CERTIFICATE_LIST_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const limit = p.limit ?? 100;
        const offset = p.offset ?? 0;
        const rows = (await callCertRows('organization.fn_certificate_list', {
            p_tenant_id: orgId,
            p_kind: p.kind ?? null,
            p_source: p.source ?? null,
            p_slot: p.slot ?? null,
            p_tag: p.tag ?? null,
            p_group_id: p.groupId ?? null,
            p_expiring_within_days: p.expiringWithinDays ?? null,
            p_limit: limit,
            p_offset: offset
        })) as Array<Counted<CertificateResponse>>;
        return buildListResponse(
            withoutTotalCount(rows),
            totalFromRows(rows),
            limit,
            offset
        );
    }

    // Audited (no @NoAudit): Get can disclose the cert PEM, so it needs a
    // forensic trail like every other authz read.
    @Component.Expose('Get')
    @Component.CheckPermissions(canViewAuthz)
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateGetParams>(
            params,
            CERTIFICATE_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const includePem = p.includePem === true && canManageAuthz(sender);
        const rows = await callCertRows('organization.fn_certificate_get', {
            p_id: p.id,
            p_tenant_id: orgId,
            p_include_pem: includePem
        });
        if (rows.length === 0) throw RpcError.NotFound('certificate');
        return rows[0];
    }

    @Component.Expose('Import')
    @Component.CheckPermissions(canManageAuthz)
    async import(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateImportParams>(
            params,
            CERTIFICATE_IMPORT_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        const meta = parseCertificateChain(p.pem, {
            privateKeyPem: p.privateKeyPem
        });
        // Device leaf certs are the only kind ingress trusts for O-routing,
        // so an imported device cert must bind to the importing org — same
        // invariant the signing paths enforce.
        if (p.kind === 'device') assertCertSubjectOrgMatches(meta, orgId);
        const encryptedKey = p.privateKeyPem
            ? encryptStringSecret(p.privateKeyPem, {
                  additionalData: privateKeyAad(orgId, meta.fingerprint_sha256)
              })
            : null;

        const result = await store.callMethod(
            'organization.fn_certificate_import',
            {
                p_tenant_id: orgId,
                p_name: p.name,
                p_kind: p.kind,
                p_pem: p.pem,
                p_private_key_encrypted: encryptedKey,
                p_fingerprint_sha256: meta.fingerprint_sha256,
                p_subject_cn: meta.subject_cn,
                p_issuer_cn: meta.issuer_cn,
                p_sans: meta.sans,
                p_key_algo: meta.key_algo,
                p_chain_depth: meta.chain_depth,
                p_basic_constraints_ca: meta.basic_constraints_ca,
                p_not_before: meta.not_before,
                p_not_after: meta.not_after,
                p_slot_compat: meta.slot_compat,
                p_device_compatible: meta.device_compatible,
                p_incompat_reasons: meta.incompat_reasons,
                p_source: 'imported',
                p_created_by: actorId,
                p_metadata: meta.metadata,
                p_tags: p.tags ?? []
            }
        );
        const rows = (result?.rows ?? []) as Array<
            CertificateResponse & {was_existing: boolean}
        >;
        const wasExisting = rows[0]?.was_existing === true;

        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId,
            operation: wasExisting ? 'import_existing' : 'import',
            certificateId: rows[0].id,
            kind: p.kind,
            fingerprintSha256: meta.fingerprint_sha256,
            hasPrivateKey: encryptedKey !== null,
            wasExisting
        });
        // Re-import of an existing cert changes the row, not the list.
        if (wasExisting) {
            EventDistributor.emitCertificateUpdated(rows[0].id, orgId);
        } else {
            EventDistributor.emitCertificateCreated(
                rows[0].id,
                rows[0].name,
                orgId
            );
        }
        return rows[0];
    }

    @Component.Expose('Update')
    @Component.CheckPermissions(canManageAuthz)
    async update(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateUpdateParams>(
            params,
            CERTIFICATE_UPDATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        if (p.name === undefined) {
            throw RpcError.InvalidParams('nothing to update');
        }
        const rows = await callCertRows(
            'organization.fn_certificate_update_name',
            {p_id: p.id, p_tenant_id: orgId, p_name: p.name}
        );
        if (rows.length === 0) throw RpcError.NotFound('certificate');
        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'update',
            certificateId: p.id,
            name: p.name
        });
        EventDistributor.emitCertificateUpdated(p.id, orgId);
        return rows[0];
    }

    @Component.Expose('Delete')
    @Component.CheckPermissions(canManageAuthz)
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateDeleteParams>(
            params,
            CERTIFICATE_DELETE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const result = await store.callMethod(
            'organization.fn_certificate_delete_safe',
            {p_id: p.id, p_tenant_id: orgId}
        );
        const summary = (result?.rows?.[0] as
            | {live_count: number; deleted_count: number}
            | undefined) ?? {live_count: 0, deleted_count: 0};
        if (summary.live_count > 0) {
            throw RpcError.InvalidParams(
                'certificate is currently applied on at least one device — replace it first'
            );
        }
        if (summary.deleted_count === 0) {
            throw RpcError.NotFound('certificate');
        }
        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'delete',
            certificateId: p.id
        });
        EventDistributor.emitCertificateDeleted(p.id, orgId);
        return {success: true};
    }

    @Component.Expose('SetTags')
    @Component.CheckPermissions(canManageAuthz)
    async setTags(
        params: unknown,
        sender: CommandSender
    ): Promise<CertificateSetTagsResponse> {
        const p = validateOrThrow<CertificateSetTagsParams>(
            params,
            CERTIFICATE_SET_TAGS_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: SET_TAGS_METRIC,
            classify: classifySetTags,
            run: () => this.#setTagsStaged(p, sender)
        });
    }

    async #setTagsStaged(
        p: CertificateSetTagsParams,
        sender: CommandSender
    ): Promise<CertificateSetTagsResponse> {
        const orgId = requireOrganizationId(sender);
        const result = await store.callMethod(
            'organization.fn_certificate_set_tags',
            {p_id: p.id, p_tenant_id: orgId, p_tags: p.tags}
        );
        const row = result?.rows?.[0] as
            | {id: string; tags: string[]}
            | undefined;
        if (!row) throw RpcError.NotFound('certificate');
        EventDistributor.emitCertificateUpdated(row.id, orgId);
        return {id: row.id, tags: row.tags};
    }

    @Component.Expose('SetGroups')
    @Component.CheckPermissions(canManageAuthz)
    async setGroups(
        params: unknown,
        sender: CommandSender
    ): Promise<CertificateSetGroupsResponse> {
        const p = validateOrThrow<CertificateSetGroupsParams>(
            params,
            CERTIFICATE_SET_GROUPS_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: SET_GROUPS_METRIC,
            classify: classifySetGroups,
            run: () => this.#setGroupsStaged(p, sender)
        });
    }

    async #setGroupsStaged(
        p: CertificateSetGroupsParams,
        sender: CommandSender
    ): Promise<CertificateSetGroupsResponse> {
        const orgId = requireOrganizationId(sender);
        const actor = sender.getUser()?.username ?? null;
        const result = await store.callMethod(
            'organization.fn_certificate_set_groups',
            {
                p_id: p.id,
                p_tenant_id: orgId,
                p_group_ids: p.groupIds,
                p_actor: actor
            }
        );
        const row = result?.rows?.[0] as
            | {fn_certificate_set_groups: number[]}
            | undefined;
        EventDistributor.emitCertificateUpdated(p.id, orgId);
        return {
            id: p.id,
            device_group_ids: row?.fn_certificate_set_groups ?? []
        };
    }

    @Component.Expose('Export')
    @Component.CheckPermissions(canManageAuthz)
    async export(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateExportParams>(
            params,
            CERTIFICATE_EXPORT_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const result = await store.callMethod(
            'organization.fn_certificate_export_row',
            {p_id: p.id, p_tenant_id: orgId}
        );
        const rows = (result?.rows ?? []) as Array<{
            id: string;
            name: string;
            pem: string;
            private_key_encrypted: string | null;
            source: string;
            fingerprint_sha256: string;
        }>;
        if (rows.length === 0) throw RpcError.NotFound('certificate');
        const row = rows[0];
        const out: {
            id: string;
            name: string;
            pem: string;
            privateKeyPem?: string;
        } = {id: row.id, name: row.name, pem: row.pem};
        if (p.includePrivateKey === true && row.private_key_encrypted) {
            out.privateKeyPem = decryptStringSecret(row.private_key_encrypted, {
                additionalData: privateKeyAad(orgId, row.fingerprint_sha256)
            });
        }
        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'export',
            certificateId: p.id,
            includePrivateKey: p.includePrivateKey === true,
            fingerprintSha256: row.fingerprint_sha256
        });
        return out;
    }

    @Component.NoAudit
    @Component.Expose('GetIssueDefaults')
    @Component.CheckPermissions(canViewAuthz)
    async getIssueDefaults(params: unknown) {
        validateOrThrow<CertificateGetIssueDefaultsParams>(
            params,
            CERTIFICATE_GET_ISSUE_DEFAULTS_PARAMS_SCHEMA
        );
        return {
            defaultValidityDays: envInt('FM_CERT_DEVICE_VALIDITY_DAYS', 365, 1),
            maxValidityDays: envInt('FM_CERT_DEVICE_MAX_VALIDITY_DAYS', 3650, 1)
        };
    }

    @Component.Expose('IssueDeviceCert')
    @Component.CheckPermissions(canManageAuthz)
    async issueDeviceCert(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateIssueDeviceParams>(
            params,
            CERTIFICATE_ISSUE_DEVICE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();
        await this.#assertDeviceBelongsToOrg(orgId, p.shellyId);
        await assertDeviceUpdateAccess(sender, [p.shellyId]);

        return this.#issueDeviceCertificateForOrg(p, orgId, actorId);
    }

    async issueProvisioningDeviceCert(params: unknown, sender: CommandSender) {
        if (!canManageAuthz(sender)) throw RpcError.Unauthorized();
        const p = validateOrThrow<CertificateIssueDeviceParams>(
            params,
            CERTIFICATE_ISSUE_DEVICE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();
        return this.#issueDeviceCertificateForOrg(p, orgId, actorId);
    }

    async #issueDeviceCertificateForOrg(
        p: CertificateIssueDeviceParams,
        orgId: string,
        actorId: string
    ): Promise<CertificateResponse> {
        if (!isFmCaAvailable()) {
            throw RpcError.Unavailable(
                'fm-ca',
                'FM CA is not mounted — verify FM_LOCAL_CA_DIR and the deploy/state/tls volume mount'
            );
        }

        let issued: Awaited<ReturnType<typeof issueDeviceCert>>;
        try {
            issued = await issueDeviceCert({
                shellyId: p.shellyId,
                organizationId: orgId,
                validityDays: p.validityDays
            });
        } catch (err) {
            if (err instanceof FmCaUnavailableError) {
                throw RpcError.Unavailable('fm-ca', err.message);
            }
            throw err;
        }

        const meta = parseCertificateChain(issued.pem, {
            privateKeyPem: issued.privateKeyPem
        });
        assertCertSubjectOrgMatches(meta, orgId);
        const encryptedKey = encryptStringSecret(issued.privateKeyPem, {
            additionalData: privateKeyAad(orgId, meta.fingerprint_sha256)
        });
        const name = p.name ?? `Device cert — ${p.shellyId}`;

        // Reuse fn_certificate_import — same insert shape, just with
        // source='fm-issued' and kind locked to 'device'.
        const result = await store.callMethod(
            'organization.fn_certificate_import',
            {
                p_tenant_id: orgId,
                p_name: name,
                p_kind: 'device',
                p_pem: issued.pem,
                p_private_key_encrypted: encryptedKey,
                p_fingerprint_sha256: meta.fingerprint_sha256,
                p_subject_cn: meta.subject_cn,
                p_issuer_cn: meta.issuer_cn,
                p_sans: meta.sans,
                p_key_algo: meta.key_algo,
                p_chain_depth: meta.chain_depth,
                p_basic_constraints_ca: meta.basic_constraints_ca,
                p_not_before: meta.not_before,
                p_not_after: meta.not_after,
                p_slot_compat: meta.slot_compat,
                p_device_compatible: meta.device_compatible,
                p_incompat_reasons: meta.incompat_reasons,
                p_source: 'fm-issued',
                p_created_by: actorId,
                p_metadata: meta.metadata,
                p_tags: []
            }
        );
        const rows = (result?.rows ?? []) as CertificateResponse[];

        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId,
            operation: 'issue_device_cert',
            certificateId: rows[0].id,
            shellyId: p.shellyId,
            fingerprintSha256: meta.fingerprint_sha256,
            serial: issued.serial,
            validityDays: p.validityDays
        });
        EventDistributor.emitCertificateCreated(rows[0].id, name, orgId);
        return rows[0];
    }

    @Component.Expose('SignCsr')
    @Component.CheckPermissions(canManageAuthz)
    async signCsr(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateSignCsrParams>(
            params,
            CERTIFICATE_SIGN_CSR_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: SIGN_CSR_METRIC,
            classify: classifySignCsr,
            run: () => this.#signCsrIssued(p, sender)
        });
    }

    async #signCsrIssued(
        p: CertificateSignCsrParams,
        sender: CommandSender
    ): Promise<CertificateResponse> {
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        if (!isFmCaAvailable()) {
            throw RpcError.Unavailable(
                'fm-ca',
                'FM CA is not mounted — verify FM_LOCAL_CA_DIR and the deploy/state/tls volume mount'
            );
        }

        const subjectCn = await extractCsrSubjectCn(p.csrPem);
        await this.#assertDeviceBelongsToOrg(orgId, subjectCn);

        let signed: Awaited<ReturnType<typeof signValidatedCsr>>;
        try {
            signed = await signValidatedCsr({
                csrPem: p.csrPem,
                subjectCn,
                organizationId: orgId,
                validityDays: p.validityDays
            });
        } catch (err) {
            if (err instanceof FmCaUnavailableError) {
                throw RpcError.Unavailable('fm-ca', err.message);
            }
            throw err;
        }

        // Operator keeps the private key (it's on the device that made
        // the CSR) — we only persist the signed leaf.
        const meta = parseCertificateChain(signed.pem);
        // Defensive post-condition: the signer already stamps O=orgId, so this
        // only fires if that ever regresses.
        assertCertSubjectOrgMatches(meta, orgId);
        const name = p.name ?? `CSR-signed — ${signed.subjectCn}`;

        const result = await store.callMethod(
            'organization.fn_certificate_import',
            {
                p_tenant_id: orgId,
                p_name: name,
                p_kind: 'device',
                p_pem: signed.pem,
                p_private_key_encrypted: null,
                p_fingerprint_sha256: meta.fingerprint_sha256,
                p_subject_cn: meta.subject_cn,
                p_issuer_cn: meta.issuer_cn,
                p_sans: meta.sans,
                p_key_algo: meta.key_algo,
                p_chain_depth: meta.chain_depth,
                p_basic_constraints_ca: meta.basic_constraints_ca,
                p_not_before: meta.not_before,
                p_not_after: meta.not_after,
                p_slot_compat: meta.slot_compat,
                p_device_compatible: meta.device_compatible,
                p_incompat_reasons: meta.incompat_reasons,
                p_source: 'fm-issued',
                p_created_by: actorId,
                p_metadata: meta.metadata,
                p_tags: []
            }
        );
        const rows = (result?.rows ?? []) as CertificateResponse[];

        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId,
            operation: 'issue_device_cert',
            certificateId: rows[0].id,
            shellyId: signed.subjectCn,
            fingerprintSha256: meta.fingerprint_sha256,
            serial: signed.serial,
            validityDays: p.validityDays
        });
        EventDistributor.emitCertificateCreated(rows[0].id, name, orgId);
        return rows[0];
    }

    @Component.NoAudit
    @Component.Expose('PreflightPush')
    @Component.CheckPermissions(canViewAuthz)
    async preflightPush(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificatePreflightPushParams>(
            params,
            CERTIFICATE_PREFLIGHT_PUSH_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const result = await store.callMethod(
            'organization.fn_certificate_get_preflight',
            {p_id: p.certificateId, p_tenant_id: orgId}
        );
        const certRows = (result?.rows ?? []) as Array<{
            slot_compat: string[] | null;
            key_algo: string | null;
        }>;
        if (certRows.length === 0) throw RpcError.NotFound('certificate');
        const deviceIds = await resolvePushTargetDevices(orgId, p.target);
        return preflight(deviceIds, p.slot, certRows[0]);
    }

    @Component.Expose('PushToDevices')
    @Component.CheckPermissions(canManageAuthz)
    async pushToDevices(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificatePushToDevicesParams>(
            params,
            CERTIFICATE_PUSH_TO_DEVICES_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();

        // Tenant ownership + slot compatibility check.
        const compatResult = await store.callMethod(
            'organization.fn_certificate_get_slot_compat',
            {p_id: p.certificateId, p_tenant_id: orgId}
        );
        const certRows = (compatResult?.rows ?? []) as Array<{
            id: string;
            slot_compat: string[] | null;
        }>;
        if (certRows.length === 0) throw RpcError.NotFound('certificate');
        const compat = certRows[0].slot_compat ?? [];
        if (!compat.includes(p.slot)) {
            throw RpcError.InvalidParams(
                `slot ${p.slot} is not in cert.slot_compat (allowed: ${compat.join(', ') || 'none'})`
            );
        }

        const deviceIds = await resolvePushTargetDevices(orgId, p.target);
        if (deviceIds.length === 0) {
            throw RpcError.InvalidParams(
                'target resolves to zero in-tenant devices'
            );
        }
        await assertDeviceUpdateAccess(sender, deviceIds);

        const jobId = await createCertificateJob({
            tenantId: orgId,
            certificateId: p.certificateId,
            slot: p.slot,
            target: p.target,
            createdBy: actorId
        });

        await enqueueCertificateTargets({
            jobId,
            tenantId: orgId,
            certificateId: p.certificateId,
            slot: p.slot,
            deviceIds
        });

        await authzAuditWriter.writeCertificateEvent({
            tenantId: orgId,
            actorId,
            operation: 'push',
            certificateId: p.certificateId,
            jobId,
            slot: p.slot,
            deviceCount: deviceIds.length,
            target: p.target
        });

        return {jobId, deviceCount: deviceIds.length};
    }

    @Component.NoAudit
    @Component.Expose('PushStatus')
    @Component.CheckPermissions(canViewAuthz)
    async pushStatus(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificatePushStatusParams>(
            params,
            CERTIFICATE_PUSH_STATUS_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const jobResult = await store.callMethod(
            'organization.fn_certificate_job_status',
            {p_job_id: p.jobId, p_tenant_id: orgId}
        );
        const jobs = (jobResult?.rows ?? []) as Array<{
            id: string;
            tenant_id: string;
            certificate_id: string;
            slot: string;
            target_summary: unknown;
            status: string;
            started_at: string | null;
            finished_at: string | null;
            created_at: string;
            created_by: string | null;
        }>;
        if (jobs.length === 0) throw RpcError.NotFound('certificate_job');
        const rowsResult = await store.callMethod(
            'organization.fn_certificate_push_rows_by_job',
            {p_job_id: p.jobId, p_tenant_id: orgId}
        );
        const rows = (rowsResult?.rows ?? []) as CertificatePushRow[];
        return {job: jobs[0], rows};
    }

    @Component.NoAudit
    @Component.Expose('ListPushes')
    @Component.CheckPermissions(canViewAuthz)
    async listPushes(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<CertificateListPushesParams>(
            params,
            CERTIFICATE_LIST_PUSHES_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const limit = p.limit ?? 100;
        const offset = p.offset ?? 0;
        const result = await store.callMethod(
            'organization.fn_certificate_list_pushes',
            {
                p_tenant_id: orgId,
                p_certificate_id: p.certificateId ?? null,
                p_device_id: p.deviceId ?? null,
                p_job_id: p.jobId ?? null,
                p_limit: limit,
                p_offset: offset
            }
        );
        const rows = (result?.rows ?? []) as Array<Counted<CertificatePushRow>>;
        return buildListResponse(
            withoutTotalCount(rows),
            totalFromRows(rows),
            limit,
            offset
        );
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
