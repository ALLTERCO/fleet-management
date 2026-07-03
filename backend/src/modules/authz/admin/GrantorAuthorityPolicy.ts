import type {
    AssignmentScope,
    AssignmentSubjectType
} from '../../../types/api/assignment';
import {
    AUTHZ_SYSTEM_PERSONA_KEYS,
    type AuthzSystemPersonaKey
} from '../../../types/api/authzCatalog';
import {scopeTypesForAssignment} from './PersonaScopeCompatibilityValidator';

export type GrantorPersona = AuthzSystemPersonaKey | 'platform_admin';
export type GrantorScopeType = ReturnType<
    typeof scopeTypesForAssignment
>[number];
export type GrantorCredentialKind = 'zitadel_pat' | 'fm_scoped_pat';
export type GrantorCredentialOperation =
    | 'create'
    | 'revoke'
    | 'bulk_revoke'
    | 'rotate';

export interface GrantorAuthorityRule {
    grantorPersona: GrantorPersona;
    grantablePersonas: readonly string[];
    grantableScopeTypes: readonly GrantorScopeType[];
    principalKinds: readonly AssignmentSubjectType[];
    canGrantServiceUsers: boolean;
    canManageCredentials: boolean;
    canGrantPlatformAdmin: false;
}

export interface GrantorAuthorityPolicyRequest {
    grantorPersonas: readonly GrantorPersona[];
    personaKey: string;
    scope: AssignmentScope;
    subjectType: AssignmentSubjectType;
}

export interface CredentialAuthorityPolicyRequest {
    grantorPersonas: readonly GrantorPersona[];
    credentialKind: GrantorCredentialKind;
    operation: GrantorCredentialOperation;
}

export interface GrantorAuthorityDecision {
    allowed: boolean;
    reason?: string;
}

const ALL_SCOPE_TYPES: readonly GrantorScopeType[] = [
    'tenant',
    'action',
    'dashboard',
    'device',
    'device_group',
    'location',
    'tag',
    'waiting_room',
    'configuration',
    'plugin',
    'report',
    'organization',
    'alert',
    'notification',
    'integration',
    'automation'
];

export const GRANTOR_AUTHORITY_RULES: readonly GrantorAuthorityRule[] = [
    createFullGrantorRule('platform_admin'),
    createFullGrantorRule('admin')
];

export function evaluateAssignmentGrantAuthority(
    request: GrantorAuthorityPolicyRequest
): GrantorAuthorityDecision {
    if (request.personaKey === 'super_admin') {
        return deny(
            'provider support authority cannot be assigned through FM assignments'
        );
    }
    if (!isSupportedSubjectType(request.subjectType)) {
        return deny('unsupported assignment subject type');
    }
    const scopeTypes = scopeTypesForAssignment(request.scope);
    if (scopeTypes.length === 0) return deny('assignment scope is empty');

    const rule = matchingRule(request.grantorPersonas, (candidate) =>
        ruleAllowsAssignment(candidate, request, scopeTypes)
    );
    if (!rule) return deny('grantor is not allowed to delegate this access');
    return allow();
}

export function evaluateCredentialGrantAuthority(
    request: CredentialAuthorityPolicyRequest
): GrantorAuthorityDecision {
    const rule = matchingRule(
        request.grantorPersonas,
        (candidate) => candidate.canManageCredentials
    );
    if (!rule) return deny('grantor is not allowed to manage credentials');
    return allow();
}

function createFullGrantorRule(
    grantorPersona: GrantorPersona
): GrantorAuthorityRule {
    return {
        grantorPersona,
        grantablePersonas: AUTHZ_SYSTEM_PERSONA_KEYS,
        grantableScopeTypes: ALL_SCOPE_TYPES,
        principalKinds: ['user', 'user_group'],
        canGrantServiceUsers: true,
        canManageCredentials: true,
        canGrantPlatformAdmin: false
    };
}

function matchingRule(
    grantorPersonas: readonly GrantorPersona[],
    predicate: (rule: GrantorAuthorityRule) => boolean
): GrantorAuthorityRule | undefined {
    return GRANTOR_AUTHORITY_RULES.find(
        (rule) =>
            grantorPersonas.includes(rule.grantorPersona) && predicate(rule)
    );
}

function ruleAllowsAssignment(
    rule: GrantorAuthorityRule,
    request: GrantorAuthorityPolicyRequest,
    scopeTypes: readonly GrantorScopeType[]
): boolean {
    return (
        rule.grantablePersonas.includes(request.personaKey) &&
        rule.principalKinds.includes(request.subjectType) &&
        scopeTypes.every((scopeType) =>
            rule.grantableScopeTypes.includes(scopeType)
        )
    );
}

function isSupportedSubjectType(
    subjectType: AssignmentSubjectType
): subjectType is AssignmentSubjectType {
    return subjectType === 'user' || subjectType === 'user_group';
}

function allow(): GrantorAuthorityDecision {
    return {allowed: true};
}

function deny(reason: string): GrantorAuthorityDecision {
    return {allowed: false, reason};
}
