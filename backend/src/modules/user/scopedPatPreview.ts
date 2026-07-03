import {effectiveShapeNoAccessReason} from '../authz';
import {applyBoundary} from '../authz/resolver';
import type {EffectiveShape, Scope} from '../authz/types';

export interface ScopedPatPreviewInput {
    userId: string;
    tenantId: string;
    builtInRoles: string[];
    boundaryScope: Scope;
}

export interface ScopedPatAccessPreview {
    usable: boolean;
    effectiveStatementCount: number;
    noAccessReason: string | null;
    effectiveShape: EffectiveShape;
}

export interface ScopedPatPreviewDeps {
    buildEffectiveShape(input: {
        userId: string;
        tenantId: string;
        builtInRoles: string[];
    }): Promise<EffectiveShape>;
}

export async function previewScopedPatAccess(
    input: ScopedPatPreviewInput,
    deps: ScopedPatPreviewDeps
): Promise<ScopedPatAccessPreview> {
    const backingShape = await deps.buildEffectiveShape(input);
    const effectiveShape = applyBoundary(backingShape, input.boundaryScope);
    return {
        usable: effectiveShape.statements.length > 0,
        effectiveStatementCount: effectiveShape.statements.length,
        noAccessReason: effectiveShapeNoAccessReason(effectiveShape) ?? null,
        effectiveShape
    };
}
