import log4js from 'log4js';
import type {
    AssignmentGrantMetadata,
    AssignmentScope,
    AssignmentSubjectType
} from '../../../types/api/assignment';
import type {
    AuthzAuditAction,
    AuthzAuditTargetType
} from '../../../types/api/authz_audit';
import {incrementCounter} from '../../Observability';
import * as store from '../../PostgresProvider';
import {invalidateAuthzTenant} from '../runtime';

const logger = log4js.getLogger('authz-audit');

export type {AuthzAuditAction, AuthzAuditTargetType};

export interface AuthzAuditEntry {
    tenantId: string | null;
    actorId: string;
    action: AuthzAuditAction;
    targetType: AuthzAuditTargetType;
    targetId: string;
    payload?: Record<string, unknown>;
}

export type AssignmentAuditOperation = 'create' | 'delete';
export type AssignmentRejectOperation = AssignmentAuditOperation;

export interface AssignmentAuditInput {
    tenantId: string;
    actorId: string;
    operation: AssignmentAuditOperation;
    assignmentId: string;
    subjectType: AssignmentSubjectType;
    subjectId: string;
    personaId: string;
    personaKey?: string;
    scope: AssignmentScope;
    metadata?: AssignmentGrantMetadata;
}

export interface AssignmentRejectAuditInput {
    tenantId: string;
    actorId: string;
    operation: AssignmentRejectOperation;
    targetId: string;
    subjectType: AssignmentSubjectType;
    subjectId: string;
    personaId: string;
    personaKey?: string;
    scope: AssignmentScope;
    metadata?: AssignmentGrantMetadata;
    reason: string;
}

export type PersonaAuditOperation = 'create' | 'update' | 'delete';

export interface PersonaAuditInput {
    tenantId: string;
    actorId: string;
    operation: PersonaAuditOperation;
    personaId: string;
    key?: string;
    name?: string;
    description?: string | null;
    statements?: unknown;
}

export type UserGroupAuditOperation =
    | 'create'
    | 'update'
    | 'delete'
    | 'add_members'
    | 'remove_members';

export interface UserGroupAuditInput {
    tenantId: string;
    actorId: string;
    operation: UserGroupAuditOperation;
    userGroupId: string;
    name?: string;
    description?: string | null;
    parentGroupId?: string | null;
    added?: string[];
    removed?: string[];
}

export type CertificateAuditOperation =
    | 'import'
    | 'import_existing'
    | 'update'
    | 'delete'
    | 'export'
    | 'issue_device_cert'
    | 'push';

export interface CertificateAuditInput {
    tenantId: string;
    actorId: string;
    operation: CertificateAuditOperation;
    certificateId: string;
    kind?: string;
    fingerprintSha256?: string;
    hasPrivateKey?: boolean;
    wasExisting?: boolean;
    name?: string;
    includePrivateKey?: boolean;
    shellyId?: string;
    serial?: string;
    validityDays?: number;
    jobId?: string;
    slot?: string;
    deviceCount?: number;
    target?: unknown;
}

export type PermissionRoleAuditOperation = 'grant_roles' | 'revoke_roles';

export interface PermissionRoleAuditInput {
    tenantId: string;
    actorId: string;
    operation: PermissionRoleAuditOperation;
    userId: string;
    roles: string[];
}

export type UserLifecycleAuditOperation = 'create' | 'update' | 'delete';
export type UserPrincipalKind = 'human_user' | 'service_user';

export interface UserLifecycleAuditInput {
    tenantId: string | null;
    actorId: string;
    operation: UserLifecycleAuditOperation;
    userId: string;
    principalKind: UserPrincipalKind;
    lifecycleOperation?: string;
    userName?: string;
    role?: string | null;
    groupCount?: number;
    assignmentCount?: number;
    revokedScopedPatCount?: number;
    previousOrganizationId?: string;
    organizationId?: string;
}

export type CredentialAuditOperation =
    | 'set'
    | 'rotate'
    | 'clear'
    | 'reveal'
    | 'retry'
    | 'confirm_old';
export type CredentialKind =
    | 'zitadel_pat'
    | 'fm_scoped_pat'
    | 'device_credential';

export type VariableAuditOperation = 'set' | 'delete';

export interface VariableAuditInput {
    tenantId: string | null;
    actorId: string;
    operation: VariableAuditOperation;
    key: string;
    /** Truncated value preview (set only). Caller redacts secrets. */
    valuePreview?: string;
}

export type AlertInstanceAuditOperation =
    | 'ack'
    | 'unack'
    | 'silence'
    | 'unsilence'
    | 'resolve_manual';

export interface AlertInstanceAuditInput {
    tenantId: string;
    actorId: string;
    operation: AlertInstanceAuditOperation;
    instanceId: number;
    ruleId?: number | null;
    ruleKind?: string | null;
    deviceId?: string | null;
    /** Silence-only: until timestamp + optional reason. */
    silencedUntil?: string;
    silenceReason?: string | null;
}

export interface ReportGeneratedAuditInput {
    tenantId: string | null;
    actorId: string;
    reportType: string;
    rows?: number;
    sizeBytes?: number;
    durationMs?: number;
    /** Output filename (sanitized) — points at the artifact in uploads/reports. */
    file?: string;
}

export interface ReportDownloadedAuditInput {
    tenantId: string | null;
    actorId: string;
    file: string;
    route: string;
}

export type NotificationTemplateAuditOperation = 'create' | 'update' | 'delete';

export interface NotificationTemplateAuditInput {
    tenantId: string;
    actorId: string;
    operation: NotificationTemplateAuditOperation;
    templateId: number;
    name?: string;
}

export type NotificationDestinationAuditOperation =
    | 'create'
    | 'update'
    | 'delete'
    | 'add_members'
    | 'remove_members';

export interface NotificationDestinationAuditInput {
    tenantId: string;
    actorId: string;
    operation: NotificationDestinationAuditOperation;
    destinationId: number;
    name?: string;
    added?: number;
    removed?: number;
}

export interface CredentialAuditInput {
    tenantId: string;
    actorId: string;
    operation: CredentialAuditOperation;
    credentialKind: CredentialKind;
    targetId: string;
    userId?: string;
    purpose?: string;
    oldTokenId?: string;
    newTokenId?: string;
    count?: number;
    error?: string;
    fallbackScheduled?: boolean;
    hasJustification?: boolean;
    jobId?: string;
    pushId?: number;
    deviceCount?: number;
}

export class AuthzAuditWriter {
    // Fired without await by many callers — must never reject.
    async write(entry: AuthzAuditEntry): Promise<void> {
        try {
            await insertAuthzAuditEntry(entry);
        } catch (err) {
            logAuditWriteFailure(entry, err);
        } finally {
            if (entry.tenantId) {
                try {
                    await invalidateAuthzTenant(entry.tenantId);
                } catch (err) {
                    logAuditWriteFailure(entry, err);
                }
            }
        }
    }

    async writeAssignmentEvent(input: AssignmentAuditInput): Promise<void> {
        await this.write(assignmentAuditEntry(input));
    }

    async writeAssignmentReject(
        input: AssignmentRejectAuditInput
    ): Promise<void> {
        await this.write(assignmentRejectAuditEntry(input));
    }

    async writePersonaEvent(input: PersonaAuditInput): Promise<void> {
        await this.write(personaAuditEntry(input));
    }

    async writeUserGroupEvent(input: UserGroupAuditInput): Promise<void> {
        await this.write(userGroupAuditEntry(input));
    }

    async writeCertificateEvent(input: CertificateAuditInput): Promise<void> {
        await this.write(certificateAuditEntry(input));
    }

    async writePermissionRoleEvent(
        input: PermissionRoleAuditInput
    ): Promise<void> {
        await this.write(permissionRoleAuditEntry(input));
    }

    async writeUserLifecycleEvent(
        input: UserLifecycleAuditInput
    ): Promise<void> {
        await this.write(userLifecycleAuditEntry(input));
    }

    async writeCredentialEvent(input: CredentialAuditInput): Promise<void> {
        await this.write(credentialAuditEntry(input));
    }

    async writeVariableEvent(input: VariableAuditInput): Promise<void> {
        await this.write(variableAuditEntry(input));
    }

    async writeAlertInstanceEvent(
        input: AlertInstanceAuditInput
    ): Promise<void> {
        await this.write(alertInstanceAuditEntry(input));
    }

    async writeReportGenerated(
        input: ReportGeneratedAuditInput
    ): Promise<void> {
        await this.write(reportGeneratedAuditEntry(input));
    }

    async writeReportDownloaded(
        input: ReportDownloadedAuditInput
    ): Promise<void> {
        await this.write(reportDownloadedAuditEntry(input));
    }

    async writeNotificationTemplateEvent(
        input: NotificationTemplateAuditInput
    ): Promise<void> {
        await this.write(notificationTemplateAuditEntry(input));
    }

    async writeNotificationDestinationEvent(
        input: NotificationDestinationAuditInput
    ): Promise<void> {
        await this.write(notificationDestinationAuditEntry(input));
    }
}

export const authzAuditWriter = new AuthzAuditWriter();

export function writeAuthzAudit(entry: AuthzAuditEntry): Promise<void> {
    return authzAuditWriter.write(entry);
}

export function assignmentAuditEntry(
    input: AssignmentAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `assignment.${input.operation}`,
        targetType: 'assignment',
        targetId: input.assignmentId,
        payload: assignmentAuditPayload(input)
    };
}

export function assignmentRejectAuditEntry(
    input: AssignmentRejectAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'assignment.reject',
        targetType: 'assignment',
        targetId: input.targetId,
        payload: {
            ...assignmentAuditPayload(input),
            operation: input.operation,
            reason: input.reason
        }
    };
}

export function personaAuditEntry(input: PersonaAuditInput): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `persona.${input.operation}`,
        targetType: 'persona',
        targetId: input.personaId,
        payload: personaAuditPayload(input)
    };
}

export function userGroupAuditEntry(
    input: UserGroupAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `user_group.${input.operation}`,
        targetType: 'user_group',
        targetId: input.userGroupId,
        payload: userGroupAuditPayload(input)
    };
}

export function certificateAuditEntry(
    input: CertificateAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `certificate.${input.operation}`,
        targetType: 'certificate',
        targetId: input.certificateId,
        payload: certificateAuditPayload(input)
    };
}

export function permissionRoleAuditEntry(
    input: PermissionRoleAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `permission.${input.operation}`,
        targetType: 'user',
        targetId: input.userId,
        payload: {roles: input.roles}
    };
}

export function userLifecycleAuditEntry(
    input: UserLifecycleAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `user.${input.operation}`,
        targetType: 'user',
        targetId: input.userId,
        payload: userLifecycleAuditPayload(input)
    };
}

export function credentialAuditEntry(
    input: CredentialAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `credential.${input.operation}`,
        targetType: 'credential',
        targetId: input.targetId,
        payload: credentialAuditPayload(input)
    };
}

export function variableAuditEntry(input: VariableAuditInput): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `variable.${input.operation}`,
        targetType: 'variable',
        targetId: input.key,
        payload: input.valuePreview
            ? {valuePreview: input.valuePreview}
            : undefined
    };
}

export function notificationTemplateAuditEntry(
    input: NotificationTemplateAuditInput
): AuthzAuditEntry {
    const payload = withoutUndefined({name: input.name});
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `notification_template.${input.operation}`,
        targetType: 'notification_template',
        targetId: String(input.templateId),
        payload: Object.keys(payload).length > 0 ? payload : undefined
    };
}

export function notificationDestinationAuditEntry(
    input: NotificationDestinationAuditInput
): AuthzAuditEntry {
    const payload = withoutUndefined({
        name: input.name,
        added: input.added,
        removed: input.removed
    });
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `notification_destination.${input.operation}`,
        targetType: 'notification_destination',
        targetId: String(input.destinationId),
        payload: Object.keys(payload).length > 0 ? payload : undefined
    };
}

export function reportGeneratedAuditEntry(
    input: ReportGeneratedAuditInput
): AuthzAuditEntry {
    const payload = withoutUndefined({
        reportType: input.reportType,
        rows: input.rows,
        sizeBytes: input.sizeBytes,
        durationMs: input.durationMs,
        file: input.file
    });
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'report.generated',
        targetType: 'report',
        targetId: input.file ?? input.reportType,
        payload: Object.keys(payload).length > 0 ? payload : undefined
    };
}

export function reportDownloadedAuditEntry(
    input: ReportDownloadedAuditInput
): AuthzAuditEntry {
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'report.downloaded',
        targetType: 'report',
        targetId: input.file,
        payload: {file: input.file, route: input.route}
    };
}

export function alertInstanceAuditEntry(
    input: AlertInstanceAuditInput
): AuthzAuditEntry {
    const payload = withoutUndefined({
        ruleId: input.ruleId ?? undefined,
        ruleKind: input.ruleKind ?? undefined,
        deviceId: input.deviceId ?? undefined,
        silencedUntil: input.silencedUntil,
        silenceReason: input.silenceReason ?? undefined
    });
    return {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: `alert_instance.${input.operation}`,
        targetType: 'alert_instance',
        targetId: String(input.instanceId),
        payload: Object.keys(payload).length > 0 ? payload : undefined
    };
}

export function authzAuditActor(user?: {
    username?: string;
    userId?: string;
}): string {
    return user?.username ?? user?.userId ?? 'admin';
}

async function insertAuthzAuditEntry(entry: AuthzAuditEntry): Promise<void> {
    await store.queryRows(
        `INSERT INTO organization.authz_audit
             (tenant_id, actor_id, action, target_type, target_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
            entry.tenantId,
            entry.actorId,
            entry.action,
            entry.targetType,
            entry.targetId,
            entry.payload ? JSON.stringify(entry.payload) : null
        ]
    );
}

function logAuditWriteFailure(entry: AuthzAuditEntry, err: unknown): void {
    incrementCounter('authz_audit_write_failures');
    logger.warn(
        'authz audit write failed (action=%s target=%s/%s): %s',
        entry.action,
        entry.targetType,
        entry.targetId,
        err
    );
}

function credentialAuditPayload(
    input: CredentialAuditInput
): Record<string, unknown> {
    return withoutUndefined({
        credentialKind: input.credentialKind,
        userId: input.userId,
        purpose: input.purpose,
        oldTokenId: input.oldTokenId,
        newTokenId: input.newTokenId,
        count: input.count,
        error: input.error,
        fallbackScheduled: input.fallbackScheduled,
        hasJustification: input.hasJustification,
        jobId: input.jobId,
        pushId: input.pushId,
        deviceCount: input.deviceCount
    });
}

function assignmentAuditPayload(
    input: AssignmentAuditInput | AssignmentRejectAuditInput
): Record<string, unknown> {
    const metadata = input.metadata ?? {};
    return withoutUndefined({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        personaId: input.personaId,
        personaKey: input.personaKey,
        scope: input.scope,
        grantReason: metadata.reason,
        grantComment: metadata.comment,
        expiresAt: metadata.expiresAt
    });
}

function personaAuditPayload(
    input: PersonaAuditInput
): Record<string, unknown> | undefined {
    const payload = withoutUndefined({
        key: input.key,
        name: input.name,
        description: input.description,
        statements: input.statements
    });
    return Object.keys(payload).length > 0 ? payload : undefined;
}

function userGroupAuditPayload(
    input: UserGroupAuditInput
): Record<string, unknown> | undefined {
    const payload = withoutUndefined({
        name: input.name,
        description: input.description,
        parentGroupId: input.parentGroupId,
        added: input.added,
        removed: input.removed
    });
    return Object.keys(payload).length > 0 ? payload : undefined;
}

function certificateAuditPayload(
    input: CertificateAuditInput
): Record<string, unknown> | undefined {
    const payload = withoutUndefined({
        kind: input.kind,
        fingerprint_sha256: input.fingerprintSha256,
        has_private_key: input.hasPrivateKey,
        was_existing: input.wasExisting,
        name: input.name,
        includePrivateKey: input.includePrivateKey,
        shellyId: input.shellyId,
        serial: input.serial,
        validityDays: input.validityDays,
        jobId: input.jobId,
        slot: input.slot,
        deviceCount: input.deviceCount,
        target: input.target
    });
    return Object.keys(payload).length > 0 ? payload : undefined;
}

function userLifecycleAuditPayload(
    input: UserLifecycleAuditInput
): Record<string, unknown> {
    return withoutUndefined({
        principalKind: input.principalKind,
        operation: input.lifecycleOperation,
        userName: input.userName,
        role: input.role,
        groupCount: input.groupCount,
        assignmentCount: input.assignmentCount,
        revokedScopedPatCount: input.revokedScopedPatCount,
        previousOrganizationId: input.previousOrganizationId,
        organizationId: input.organizationId
    });
}

function withoutUndefined(
    values: Record<string, unknown | undefined>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined)
    );
}
