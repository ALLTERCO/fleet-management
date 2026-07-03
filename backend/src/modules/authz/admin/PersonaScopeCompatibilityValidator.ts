import RpcError from '../../../rpc/RpcError';
import type {AssignmentScope} from '../../../types/api/assignment';
import {
    AUTHZ_SYSTEM_PERSONA_KEYS,
    AUTHZ_SYSTEM_PERSONA_SCOPE_TYPES,
    type AuthzScopeType,
    type AuthzSystemPersonaKey
} from '../../../types/api/authzCatalog';

// The persona↔scope-type matrix lives in the shared authz catalog so the
// frontend picker offers exactly what this validator accepts.
type ScopeType = AuthzScopeType;

const SYSTEM_PERSONAS = new Set<string>(AUTHZ_SYSTEM_PERSONA_KEYS);

export interface PersonaScopeCompatibilityRequest {
    personaKey: string;
    scope: AssignmentScope;
}

export function scopeTypesForAssignment(scope: AssignmentScope): ScopeType[] {
    const types = new Set<ScopeType>();
    if (scope.all === true) types.add('tenant');
    if (scope.actions?.length) types.add('action');
    if (scope.dashboard_ids?.length) types.add('dashboard');
    if (scope.device_ids?.length) types.add('device');
    if (scope.device_group_ids?.length) types.add('device_group');
    if (scope.location_ids?.length) types.add('location');
    if (scope.device_tags?.length) types.add('tag');
    if (scope.waiting_room_ids?.length) types.add('waiting_room');
    if (scope.configuration_keys?.length) types.add('configuration');
    if (scope.plugin_keys?.length) types.add('plugin');
    if (scope.report_ids?.length) types.add('report');
    if (scope.organization_ids?.length) types.add('organization');
    if (scope.alert_ids?.length) types.add('alert');
    if (scope.notification_ids?.length) types.add('notification');
    if (scope.integration_keys?.length) types.add('integration');
    if (scope.automation_ids?.length) types.add('automation');
    return [...types];
}

function isSystemPersonaKey(key: string): key is AuthzSystemPersonaKey {
    return SYSTEM_PERSONAS.has(key);
}

export function assertPersonaScopeCompatible(
    request: PersonaScopeCompatibilityRequest
): void {
    if (request.personaKey === 'super_admin') {
        throw RpcError.InvalidParams(
            'provider support authority cannot be assigned through FM assignments'
        );
    }

    if (!isSystemPersonaKey(request.personaKey)) {
        return;
    }

    const allowed = new Set(
        AUTHZ_SYSTEM_PERSONA_SCOPE_TYPES[request.personaKey]
    );
    const rejected = scopeTypesForAssignment(request.scope).filter(
        (scopeType) => !allowed.has(scopeType)
    );
    if (rejected.length === 0) return;

    throw RpcError.InvalidParams(
        `persona ${request.personaKey} cannot be assigned on scope type ${rejected[0]}`
    );
}
