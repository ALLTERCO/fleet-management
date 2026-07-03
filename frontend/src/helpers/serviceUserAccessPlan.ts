import type {AssignmentScope} from '@api/assignment';
import {authzGrantIsHighRisk} from '@api/authzCatalog';
import {buildScope} from './scopeDimensions';
import type {PickedScopedPatBoundary} from './scopedPatCreate';

export interface ServiceUserAssignmentDraft {
    personaId: string;
    // Full persona access, or narrow it to the picked resources.
    scopeAll: boolean;
    scope: PickedScopedPatBoundary;
    reason: string;
}

export interface ServiceUserAccessAssignment {
    personaId: string;
    scope: AssignmentScope;
    reason?: string;
    expiresAt?: string;
}

export interface ServiceUserAccessPreviewInput {
    groupNames: string[];
    assignmentLabels: string[];
    role: string;
}

export function buildServiceUserAccessAssignment(
    draft: ServiceUserAssignmentDraft,
    personaKey: string | undefined
): ServiceUserAccessAssignment | null {
    const personaId = draft.personaId.trim();
    if (!personaId) return null;
    const scope = buildScope(draft.scopeAll, draft.scope);
    if (!scope) return null;
    const reason = draft.reason.trim();
    // High-risk grants to humans need a reason; only machine credentials
    // additionally need an expiry (handled by the service-user flows).
    if (authzGrantIsHighRisk(personaKey ?? '', draft.scopeAll) && !reason) {
        return null;
    }
    return reason ? {personaId, scope, reason} : {personaId, scope};
}

export function serviceUserScopeLabel(scope: AssignmentScope): string {
    if (scope.all) return 'All resources';
    const parts = scopeParts(scope);
    return parts.length > 0 ? parts.join(' · ') : 'No scope';
}

export function serviceUserAssignmentLabel(
    assignment: ServiceUserAccessAssignment,
    personaName: string
): string {
    const reason = assignment.reason ? ` — ${assignment.reason}` : '';
    return `${personaName}: ${serviceUserScopeLabel(assignment.scope)}${reason}`;
}

export function serviceUserAccessPreviewRows(
    input: ServiceUserAccessPreviewInput
): string[] {
    return [
        ...roleRows(input.role),
        ...input.groupNames.map((name) => `Group: ${name}`),
        ...input.assignmentLabels.map((label) => `Direct: ${label}`)
    ];
}

function roleRows(role: string): string[] {
    const trimmed = role.trim();
    return trimmed ? [`Built-in role: ${trimmed}`] : [];
}

function scopeParts(scope: AssignmentScope): string[] {
    const parts: string[] = [];
    pushPart(parts, scope.device_ids, 'devices');
    pushPart(parts, scope.device_tags, 'tags');
    pushPart(parts, scope.location_ids, 'locations');
    pushPart(parts, scope.device_group_ids, 'device groups');
    pushPart(parts, scope.dashboard_ids, 'dashboards');
    pushPart(parts, scope.plugin_keys, 'plugins');
    pushPart(parts, scope.waiting_room_ids, 'waiting-room devices');
    pushPart(parts, scope.configuration_keys, 'configuration keys');
    pushPart(parts, scope.report_ids, 'reports');
    pushPart(parts, scope.organization_ids, 'organizations');
    pushPart(parts, scope.alert_ids, 'alerts');
    pushPart(parts, scope.notification_ids, 'notifications');
    pushPart(parts, scope.integration_keys, 'integrations');
    pushPart(parts, scope.automation_ids, 'automations');
    return parts;
}

function pushPart(
    parts: string[],
    values: readonly unknown[] | undefined,
    label: string
): void {
    if (!values?.length) return;
    parts.push(`${values.length} ${label}`);
}
