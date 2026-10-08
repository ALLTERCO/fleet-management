// Materializes login roles as assignments: the resolver reads assignments alone.

import {
    AUTHZ_SYSTEM_PERSONA_KEYS,
    type AuthzSystemPersonaKey
} from '../../types/api/authzCatalog';
import {SIGN_IN_BASELINE_ROLE} from './roleGrants';

export type LegacyRoleMigrationMode = 'dry-run' | 'apply';

export interface LegacyRoleMigrationSubject {
    userId: string;
    userName: string;
}

export interface PlannedRoleAssignment {
    tenantId: string;
    userId: string;
    userName: string;
    personaKey: AuthzSystemPersonaKey;
    personaId: string;
}

export interface SubjectRolePlan {
    tenantId: string;
    userId: string;
    userName: string;
    hasExistingAssignment: boolean;
    materialize: AuthzSystemPersonaKey[];
    // Only ever the sign-in baseline role, kept per user for the dry-run list.
    droppedSignInOnly: AuthzSystemPersonaKey[];
    alreadyAssigned: AuthzSystemPersonaKey[];
}

export interface LegacyRoleMigrationDeps {
    listTenantIds(): Promise<string[]>;
    listSubjects(tenantId: string): Promise<LegacyRoleMigrationSubject[]>;
    listRoleKeysByUser(
        tenantId: string,
        userIds: string[]
    ): Promise<Map<string, string[]>>;
    // Live assignments only, so a lapsed grant neither blocks nor counts.
    listAssignedPersonaIdsByUser(
        tenantId: string,
        userIds: string[]
    ): Promise<Map<string, string[]>>;
    listSystemPersonaIdsByKey(): Promise<Map<string, string>>;
    createAssignment(planned: PlannedRoleAssignment): Promise<boolean>;
    invalidateTenant(tenantId: string): Promise<void>;
}

export interface LegacyRoleMigrationReport {
    mode: LegacyRoleMigrationMode;
    tenantIds: string[];
    subjectsScanned: number;
    subjectsWithExistingAssignment: number;
    subjectsWithoutBuiltInRole: number;
    // Users with something to do or to drop; the rest are counted only.
    subjects: SubjectRolePlan[];
    planned: PlannedRoleAssignment[];
    signInOnlyViewersDropped: number;
    rolesAlreadyAssigned: number;
    created: number;
    alreadyPresent: number;
    unmatchedRoleKeys: string[];
}

interface TenantPlan {
    subjects: SubjectRolePlan[];
    planned: PlannedRoleAssignment[];
    subjectsScanned: number;
    subjectsWithExistingAssignment: number;
    subjectsWithoutBuiltInRole: number;
    signInOnlyViewersDropped: number;
    rolesAlreadyAssigned: number;
    unmatchedRoleKeys: string[];
}

// Priority order, highest first, and drops role keys that are not personas.
function builtInPersonaKeys(
    roleKeys: readonly string[]
): AuthzSystemPersonaKey[] {
    return AUTHZ_SYSTEM_PERSONA_KEYS.filter((key) => roleKeys.includes(key));
}

export async function migrateLegacyRoleAssignments(
    deps: LegacyRoleMigrationDeps,
    options: {mode: LegacyRoleMigrationMode; tenantIds?: string[]}
): Promise<LegacyRoleMigrationReport> {
    const tenantIds =
        options.tenantIds && options.tenantIds.length > 0
            ? options.tenantIds
            : await deps.listTenantIds();
    const personaIdByKey = await deps.listSystemPersonaIdsByKey();
    const report: LegacyRoleMigrationReport = {
        mode: options.mode,
        tenantIds,
        subjectsScanned: 0,
        subjectsWithExistingAssignment: 0,
        subjectsWithoutBuiltInRole: 0,
        subjects: [],
        planned: [],
        signInOnlyViewersDropped: 0,
        rolesAlreadyAssigned: 0,
        created: 0,
        alreadyPresent: 0,
        unmatchedRoleKeys: []
    };

    for (const tenantId of tenantIds) {
        const plan = await planTenant(deps, tenantId, personaIdByKey);
        report.subjectsScanned += plan.subjectsScanned;
        report.subjectsWithExistingAssignment +=
            plan.subjectsWithExistingAssignment;
        report.subjectsWithoutBuiltInRole += plan.subjectsWithoutBuiltInRole;
        report.signInOnlyViewersDropped += plan.signInOnlyViewersDropped;
        report.rolesAlreadyAssigned += plan.rolesAlreadyAssigned;
        report.subjects.push(...plan.subjects);
        report.planned.push(...plan.planned);
        for (const key of plan.unmatchedRoleKeys) {
            if (!report.unmatchedRoleKeys.includes(key)) {
                report.unmatchedRoleKeys.push(key);
            }
        }
        if (options.mode === 'dry-run') continue;
        const written = await applyTenantPlan(deps, plan.planned);
        report.created += written.created;
        report.alreadyPresent += written.alreadyPresent;
        if (written.created > 0) await deps.invalidateTenant(tenantId);
    }
    return report;
}

async function planTenant(
    deps: LegacyRoleMigrationDeps,
    tenantId: string,
    personaIdByKey: Map<string, string>
): Promise<TenantPlan> {
    const plan: TenantPlan = {
        subjects: [],
        planned: [],
        subjectsScanned: 0,
        subjectsWithExistingAssignment: 0,
        subjectsWithoutBuiltInRole: 0,
        signInOnlyViewersDropped: 0,
        rolesAlreadyAssigned: 0,
        unmatchedRoleKeys: []
    };
    const subjects = await deps.listSubjects(tenantId);
    plan.subjectsScanned = subjects.length;
    if (subjects.length === 0) return plan;

    const userIds = subjects.map((subject) => subject.userId);
    const assignedPersonaIds = await deps.listAssignedPersonaIdsByUser(
        tenantId,
        userIds
    );
    const roleKeysByUser = await deps.listRoleKeysByUser(tenantId, userIds);

    for (const subject of subjects) {
        const personaKeys = builtInPersonaKeys(
            roleKeysByUser.get(subject.userId) ?? []
        );
        const held = assignedPersonaIds.get(subject.userId) ?? [];
        if (held.length > 0) plan.subjectsWithExistingAssignment++;
        if (personaKeys.length === 0) {
            plan.subjectsWithoutBuiltInRole++;
            continue;
        }
        const subjectPlan = planSubject(
            {tenantId, subject, personaKeys, held, personaIdByKey},
            plan
        );
        if (
            subjectPlan.materialize.length > 0 ||
            subjectPlan.droppedSignInOnly.length > 0
        ) {
            plan.subjects.push(subjectPlan);
        }
    }
    return plan;
}

function planSubject(
    input: {
        tenantId: string;
        subject: LegacyRoleMigrationSubject;
        personaKeys: AuthzSystemPersonaKey[];
        held: string[];
        personaIdByKey: Map<string, string>;
    },
    plan: TenantPlan
): SubjectRolePlan {
    const hasExistingAssignment = input.held.length > 0;
    const subjectPlan: SubjectRolePlan = {
        tenantId: input.tenantId,
        userId: input.subject.userId,
        userName: input.subject.userName,
        hasExistingAssignment,
        materialize: [],
        droppedSignInOnly: [],
        alreadyAssigned: []
    };
    for (const personaKey of input.personaKeys) {
        const personaId = input.personaIdByKey.get(personaKey);
        if (!personaId) {
            if (!plan.unmatchedRoleKeys.includes(personaKey)) {
                plan.unmatchedRoleKeys.push(personaKey);
            }
            continue;
        }
        if (input.held.includes(personaId)) {
            subjectPlan.alreadyAssigned.push(personaKey);
            plan.rolesAlreadyAssigned++;
            continue;
        }
        // The baseline role bought a sign-in, not a grant worth keeping.
        if (personaKey === SIGN_IN_BASELINE_ROLE && hasExistingAssignment) {
            subjectPlan.droppedSignInOnly.push(personaKey);
            plan.signInOnlyViewersDropped++;
            continue;
        }
        subjectPlan.materialize.push(personaKey);
        plan.planned.push({
            tenantId: input.tenantId,
            userId: input.subject.userId,
            userName: input.subject.userName,
            personaKey,
            personaId
        });
    }
    return subjectPlan;
}

async function applyTenantPlan(
    deps: LegacyRoleMigrationDeps,
    planned: PlannedRoleAssignment[]
): Promise<{created: number; alreadyPresent: number}> {
    let created = 0;
    let alreadyPresent = 0;
    for (const grant of planned) {
        if (await deps.createAssignment(grant)) created++;
        else alreadyPresent++;
    }
    return {created, alreadyPresent};
}
