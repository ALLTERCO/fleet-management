import type CommandSender from '../../../model/CommandSender';
import RpcError from '../../../rpc/RpcError';
import type {
    AssignmentScope,
    AssignmentSubjectType
} from '../../../types/api/assignment';
import type {AuthzSystemPersonaKey} from '../../../types/api/authzCatalog';
import {
    evaluateAssignmentGrantAuthority,
    evaluateCredentialGrantAuthority,
    type GrantorCredentialKind,
    type GrantorCredentialOperation,
    type GrantorPersona
} from './GrantorAuthorityPolicy';

type Grantor = Pick<
    CommandSender,
    'getRoles' | 'hasCredentialBoundary' | 'isAdmin' | 'isPlatformAdmin'
>;

export interface GrantorAuthorityRequest {
    grantor: Grantor;
    personaKey: string;
    scope: AssignmentScope;
    subjectType: AssignmentSubjectType;
}

export interface DeleteGrantAuthorityRequest {
    grantor: Grantor;
}

export interface CredentialGrantAuthorityRequest {
    grantor: Grantor;
    credentialKind: GrantorCredentialKind;
    operation: GrantorCredentialOperation;
}

export function assertGrantorCanCreateAssignment(
    request: GrantorAuthorityRequest
): void {
    if (request.personaKey === 'super_admin') {
        throw RpcError.InvalidParams(
            'provider support authority cannot be assigned through FM assignments'
        );
    }

    assertGrantorHasFullAdminAuthority(request.grantor);
    assertGrantorPolicyAllowsAssignment(request);
}

export function assertGrantorCanDeleteAssignment(
    request: DeleteGrantAuthorityRequest
): void {
    assertGrantorHasFullAdminAuthority(request.grantor);
}

export function assertGrantorCanManageCredential(
    request: CredentialGrantAuthorityRequest
): void {
    assertGrantorHasFullAdminAuthority(request.grantor);
    assertGrantorPolicyAllowsCredential(request);
}

function assertGrantorHasFullAdminAuthority(grantor: Grantor): void {
    if (grantor.hasCredentialBoundary()) {
        throw RpcError.Unauthorized();
    }
    if (!grantor.isAdmin()) {
        throw RpcError.Unauthorized();
    }
}

function assertGrantorPolicyAllowsAssignment(
    request: GrantorAuthorityRequest
): void {
    const decision = evaluateAssignmentGrantAuthority({
        grantorPersonas: grantorPersonas(request.grantor),
        personaKey: request.personaKey,
        scope: request.scope,
        subjectType: request.subjectType
    });
    if (decision.allowed) return;
    throw RpcError.InvalidParams(decision.reason);
}

function assertGrantorPolicyAllowsCredential(
    request: CredentialGrantAuthorityRequest
): void {
    const decision = evaluateCredentialGrantAuthority({
        grantorPersonas: grantorPersonas(request.grantor),
        credentialKind: request.credentialKind,
        operation: request.operation
    });
    if (decision.allowed) return;
    throw RpcError.InvalidParams(decision.reason);
}

function grantorPersonas(grantor: Grantor): GrantorPersona[] {
    if (grantor.isPlatformAdmin()) return ['platform_admin'];
    return grantor.getRoles().filter(isGrantorPersona);
}

function isGrantorPersona(role: string): role is AuthzSystemPersonaKey {
    return (
        role === 'admin' ||
        role === 'manager' ||
        role === 'editor' ||
        role === 'installer' ||
        role === 'operator' ||
        role === 'automation_admin' ||
        role === 'auditor' ||
        role === 'viewer'
    );
}
