import type {
    AccessProvenance,
    EffectiveShape,
    ResolvedStatement
} from './types';

export interface AccessRoleSummary {
    baseRoles: readonly string[];
    directAssignments: AccessProvenance[];
    groupAssignments: AccessProvenance[];
}

export function statementToAccessProvenance(
    statement: ResolvedStatement
): AccessProvenance {
    return {
        source: statement.source ?? 'built-in-jwt',
        persona: statement.persona,
        assignmentId: statement.assignmentId,
        subjectType: statement.subjectType,
        subjectId: statement.subjectId,
        grantorId: statement.grantorId,
        expiresAt: statement.assignmentExpiresAt,
        actions: statement.actions,
        resourceTypes: statement.resourceTypes,
        scope: statement.scope,
        effect: statement.effect
    };
}

export function accessProvenanceFromShape(
    shape: EffectiveShape
): AccessProvenance[] {
    return shape.statements.map(statementToAccessProvenance);
}

export function summarizeAccessProvenance(
    baseRoles: readonly string[],
    provenance: readonly AccessProvenance[]
): AccessRoleSummary {
    return {
        baseRoles,
        directAssignments: provenance.filter(isDirectAssignment),
        groupAssignments: provenance.filter(isGroupAssignment)
    };
}

export function emptyAccessRoleSummary(): AccessRoleSummary {
    return {
        baseRoles: [],
        directAssignments: [],
        groupAssignments: []
    };
}

export function effectiveShapeNoAccessReason(
    shape: EffectiveShape
): string | undefined {
    return shape.statements.length === 0
        ? 'No effective permissions are assigned.'
        : undefined;
}

function isDirectAssignment(entry: AccessProvenance): boolean {
    return entry.source === 'user-assignment';
}

function isGroupAssignment(entry: AccessProvenance): boolean {
    return entry.source === 'group-assignment';
}
