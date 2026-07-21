import type CommandSender from '../../../model/CommandSender';
import RpcError from '../../../rpc/RpcError';
import type {
    AssignmentGrantMetadata,
    AssignmentResponse,
    AssignmentScope,
    AssignmentSubjectType
} from '../../../types/api/assignment';
import {authzGrantIsHighRisk} from '../../../types/api/authzCatalog';
import * as store from '../../PostgresProvider';
import {userIsServiceUser} from '../../user/subjectPrincipal';
import {authzAuditWriter} from '../audit';
import {isExplicitScope, SCOPE_NOT_EXPLICIT_MESSAGE} from '../scopeGuard';
import {normalizeAssignmentGrantMetadata} from './AssignmentGrantMetadataValidator';
import {
    assertGrantorCanCreateAssignment,
    assertGrantorCanDeleteAssignment
} from './GrantorAuthorityValidator';
import {assertPersonaScopeCompatible} from './PersonaScopeCompatibilityValidator';

interface AttachablePersona {
    key: string;
    is_system_managed: boolean;
}

export interface AssignmentGrantRequest {
    tenantId: string;
    actorId: string;
    grantor: CommandSender;
    subjectType: AssignmentSubjectType;
    subjectId: string;
    personaId: string;
    scope: AssignmentScope;
    metadata?: AssignmentGrantMetadata;
    // Known by some callers (service-user flows); resolved from Zitadel
    // metadata when omitted. Never taken from the wire — trust boundary.
    subjectIsServiceUser?: boolean;
}

export interface AssignmentDeleteRequest {
    tenantId: string;
    actorId: string;
    grantor: CommandSender;
    assignmentId: string;
}

interface ExistingAssignmentGrant {
    id: string;
    subject_type: AssignmentSubjectType;
    subject_id: string;
    persona_id: string;
    persona_key: string;
    scope: AssignmentScope;
    reason: string | null;
    comment: string | null;
    expires_at: string | null;
}

export async function createAssignmentGrant(
    request: AssignmentGrantRequest
): Promise<AssignmentResponse> {
    try {
        const persona = await loadAttachablePersona(
            request.personaId,
            request.tenantId
        );
        const subjectIsServiceUser = await resolveSubjectIsServiceUser(
            request,
            persona.key
        );
        const metadata = validateAssignmentGrant(
            {...request, subjectIsServiceUser},
            persona
        );
        return writeAssignmentGrant(request, metadata);
    } catch (error) {
        await auditAssignmentReject(request, error);
        throw error;
    }
}

// Resolve lazily: the Zitadel lookup only matters for high-risk user grants.
async function resolveSubjectIsServiceUser(
    request: AssignmentGrantRequest,
    personaKey: string
): Promise<boolean> {
    if (request.subjectIsServiceUser !== undefined) {
        return request.subjectIsServiceUser;
    }
    if (request.subjectType !== 'user') return false;
    if (!authzGrantIsHighRisk(personaKey, request.scope.all === true)) {
        return false;
    }
    return userIsServiceUser(request.subjectId);
}

// Everything createAssignmentGrant would reject, checked WITHOUT writing.
// Callers that create an identity first (service users) run this before the
// identity exists, so a rejected grant cannot leave an orphan behind. The
// caller must state the subject kind — there is no subject to look up yet.
export type AssignmentGrantPrecheck = Omit<
    AssignmentGrantRequest,
    'subjectId' | 'actorId' | 'subjectIsServiceUser'
> & {subjectIsServiceUser: boolean};

export async function assertAssignmentGrantAllowed(
    request: AssignmentGrantPrecheck
): Promise<void> {
    const persona = await loadAttachablePersona(
        request.personaId,
        request.tenantId
    );
    validateAssignmentGrant(request, persona);
}

export async function loadAttachablePersona(
    personaId: string,
    tenantId: string
): Promise<AttachablePersona> {
    const rows = await store.queryRows<AttachablePersona>(
        `SELECT key, is_system_managed
           FROM organization.personas
          WHERE id = $1
            AND (tenant_id = $2 OR tenant_id IS NULL)`,
        [personaId, tenantId]
    );
    if (rows.length === 0) throw RpcError.NotFound('persona');
    return rows[0];
}

export async function deleteAssignmentGrant(
    request: AssignmentDeleteRequest
): Promise<{success: true}> {
    const assignment = await loadExistingAssignmentGrant(request);
    try {
        assertGrantorCanDeleteAssignment({grantor: request.grantor});
    } catch (error) {
        await auditAssignmentDeleteReject(request, assignment, error);
        throw error;
    }

    const result = await store.callMethod('organization.fn_assignment_delete', {
        p_id: request.assignmentId,
        p_tenant_id: request.tenantId
    });
    const rows = (result?.rows ?? []) as Array<{id: string}>;
    if (rows.length === 0) throw RpcError.NotFound('assignment');
    await authzAuditWriter.writeAssignmentEvent({
        tenantId: request.tenantId,
        actorId: request.actorId,
        operation: 'delete',
        assignmentId: request.assignmentId,
        subjectType: assignment.subject_type,
        subjectId: assignment.subject_id,
        personaId: assignment.persona_id,
        personaKey: assignment.persona_key,
        scope: assignment.scope,
        metadata: {
            reason: assignment.reason ?? undefined,
            comment: assignment.comment ?? undefined,
            expiresAt: assignment.expires_at ?? undefined
        }
    });
    return {success: true};
}

function validateAssignmentGrant(
    request: Pick<
        AssignmentGrantRequest,
        'grantor' | 'subjectType' | 'scope' | 'metadata'
    > & {subjectIsServiceUser: boolean},
    persona: AttachablePersona
): ReturnType<typeof normalizeAssignmentGrantMetadata> {
    if (!isExplicitScope(request.scope)) {
        throw RpcError.InvalidParams(SCOPE_NOT_EXPLICIT_MESSAGE);
    }
    assertPersonaScopeCompatible({
        personaKey: persona.key,
        scope: request.scope
    });
    assertGrantorCanCreateAssignment({
        grantor: request.grantor,
        personaKey: persona.key,
        scope: request.scope,
        subjectType: request.subjectType
    });
    return normalizeAssignmentGrantMetadata({
        metadata: request.metadata ?? {},
        personaKey: persona.key,
        scope: request.scope,
        subjectType: request.subjectType,
        subjectIsServiceUser: request.subjectIsServiceUser
    });
}

async function loadExistingAssignmentGrant(
    request: AssignmentDeleteRequest
): Promise<ExistingAssignmentGrant> {
    const rows = await store.queryRows<ExistingAssignmentGrant>(
        `SELECT a.id::text,
                a.subject_type,
                a.subject_id::text,
                a.persona_id::text,
                p.key AS persona_key,
                organization.fn_assignment_scope_external(a.id, a.scope) AS scope,
                a.reason,
                a.comment,
                a.expires_at::text
           FROM organization.assignments a
           JOIN organization.personas p ON p.id = a.persona_id
          WHERE a.id = $1
            AND a.tenant_id = $2`,
        [request.assignmentId, request.tenantId]
    );
    if (rows.length === 0) throw RpcError.NotFound('assignment');
    return rows[0];
}

async function auditAssignmentReject(
    request: AssignmentGrantRequest,
    error: unknown
): Promise<void> {
    await authzAuditWriter.writeAssignmentReject({
        tenantId: request.tenantId,
        actorId: request.actorId,
        operation: 'create',
        targetId: request.subjectId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        personaId: request.personaId,
        scope: request.scope,
        metadata: request.metadata ?? {},
        reason: errorReason(error)
    });
}

async function auditAssignmentDeleteReject(
    request: AssignmentDeleteRequest,
    assignment: ExistingAssignmentGrant,
    error: unknown
): Promise<void> {
    await authzAuditWriter.writeAssignmentReject({
        tenantId: request.tenantId,
        actorId: request.actorId,
        operation: 'delete',
        targetId: request.assignmentId,
        subjectType: assignment.subject_type,
        subjectId: assignment.subject_id,
        personaId: assignment.persona_id,
        personaKey: assignment.persona_key,
        scope: assignment.scope,
        metadata: {
            reason: assignment.reason ?? undefined,
            comment: assignment.comment ?? undefined,
            expiresAt: assignment.expires_at ?? undefined
        },
        reason: errorReason(error)
    });
}

function errorReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function writeAssignmentGrant(
    request: AssignmentGrantRequest,
    metadata: ReturnType<typeof normalizeAssignmentGrantMetadata>
): Promise<AssignmentResponse> {
    const result = await store.callMethod('organization.fn_assignment_create', {
        p_tenant_id: request.tenantId,
        p_subject_type: request.subjectType,
        p_subject_id: request.subjectId,
        p_persona_id: request.personaId,
        p_scope: JSON.stringify(request.scope),
        p_created_by: request.actorId,
        p_reason: metadata.reason,
        p_comment: metadata.comment,
        p_expires_at: metadata.expiresAt
    });
    const rows = (result?.rows ?? []) as AssignmentResponse[];
    const assignment = rows[0];
    await authzAuditWriter.writeAssignmentEvent({
        tenantId: request.tenantId,
        actorId: request.actorId,
        operation: 'create',
        assignmentId: assignment.id,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        personaId: request.personaId,
        scope: request.scope,
        metadata
    });
    return assignment;
}
