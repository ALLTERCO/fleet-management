import type {AssignmentScope} from '@api/assignment';
import {authzGrantIsHighRisk} from '@api/authzCatalog';
import {buildScope, type ScopeSelection} from './scopeDimensions';

// Create grants one starter role, scopeable to all or specific resources.
// More roles are managed afterwards under Edit → Assignments.
export interface ServiceUserCreateForm {
    userName: string;
    name: string;
    description: string;
    personaId: string;
    scopeAll: boolean;
    scope: ScopeSelection;
    // High-risk grants (admin/manager + everything) must say why and expire.
    accessReason: string;
    accessExpiresDays: string;
}

export interface ServiceUserCreatePayload {
    userName: string;
    name: string;
    description?: string;
    assignments?: Array<{
        personaId: string;
        scope: AssignmentScope;
        reason?: string;
        expiresAt?: string;
    }>;
}

// Grant-expiry choices shared by every grant UI.
export const GRANT_EXPIRY_OPTIONS = [
    {value: '30', label: '30 days'},
    {value: '90', label: '90 days'},
    {value: '180', label: '180 days'},
    {value: '365', label: '1 year'}
] as const;

export function grantExpiryIso(days: string): string {
    const parsed = Number.parseInt(days, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`invalid grant expiry: "${days}"`);
    }
    return new Date(Date.now() + parsed * 86_400_000).toISOString();
}

// Usernames are slugs of the friendly name, so people never invent ids:
// "CI pipeline" -> "ci-pipeline".
export function deriveServiceUsername(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function serviceUserGrantIsHighRisk(
    form: Pick<ServiceUserCreateForm, 'scopeAll'>,
    personaKey: string | undefined
): boolean {
    return authzGrantIsHighRisk(personaKey ?? '', form.scopeAll);
}

// The starter role is ready once a persona is picked, its scope resolves —
// "all", or "specific" with at least one resource — and, for high-risk
// grants, a reason is given.
export function serviceUserAccessReady(
    form: ServiceUserCreateForm,
    personaKey: string | undefined
): boolean {
    if (form.personaId.trim() === '') return false;
    if (buildScope(form.scopeAll, form.scope) === null) return false;
    if (!serviceUserGrantIsHighRisk(form, personaKey)) return true;
    return form.accessReason.trim() !== '';
}

export function buildServiceUserCreatePayload(
    form: ServiceUserCreateForm,
    personaKey: string | undefined
): ServiceUserCreatePayload {
    const payload: ServiceUserCreatePayload = {
        userName: form.userName.trim(),
        name: form.name.trim()
    };
    const description = form.description.trim();
    if (description) payload.description = description;
    const personaId = form.personaId.trim();
    const scope = buildScope(form.scopeAll, form.scope);
    if (!personaId || !scope) return payload;
    const assignment: NonNullable<
        ServiceUserCreatePayload['assignments']
    >[number] = {personaId, scope};
    if (serviceUserGrantIsHighRisk(form, personaKey)) {
        assignment.reason = form.accessReason.trim();
        assignment.expiresAt = grantExpiryIso(form.accessExpiresDays);
    }
    payload.assignments = [assignment];
    return payload;
}
