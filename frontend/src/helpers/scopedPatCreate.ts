import {buildScope, type ScopeSelection} from './scopeDimensions';

// The picked boundary is any subset of the contract's scope dimensions —
// one shared type, defined in scopeDimensions.
export type PickedScopedPatBoundary = ScopeSelection;

export type McpKeyLevel = 'read' | 'write' | 'full';

export interface ScopedPatCreateInput {
    userId: string | undefined;
    expirationDaysText: string;
    scoped: boolean;
    scopeAll: boolean;
    pickedScope: PickedScopedPatBoundary;
    purpose: string;
    // Scopes the key for the MCP surface at a level (audience `mcp:<level>`).
    // Undefined = not for MCP.
    mcpLevel?: McpKeyLevel;
    // Optional human label for the key (Zitadel PATs only — stored FM-side).
    name?: string;
}

export type PatCreatePlan =
    | {
          kind: 'zitadel_pat';
          createMethod: 'User.CreatePAT';
          createParams: {
              userId: string;
              name?: string;
              expirationDays?: number;
          };
      }
    | {
          kind: 'fm_scoped_pat';
          previewMethod: 'User.PreviewScopedPAT';
          previewParams: {
              userId: string;
              boundaryScope: Record<string, unknown>;
          };
          createMethod: 'User.CreateScopedPAT';
          createParams: {
              userId: string;
              boundaryScope: Record<string, unknown>;
              purpose: string;
              audience?: string[];
              expirationDays?: number;
          };
      };

export function buildPatCreatePlan(input: ScopedPatCreateInput): PatCreatePlan {
    const userId = requireUserId(input.userId);
    const expirationDays = parseExpirationDays(input.expirationDaysText);
    if (!input.scoped) {
        const trimmedName = input.name?.trim();
        const base = trimmedName ? {userId, name: trimmedName} : {userId};
        return {
            kind: 'zitadel_pat',
            createMethod: 'User.CreatePAT',
            createParams: withExpirationDays(base, expirationDays)
        };
    }
    const purpose = requirePurpose(input.purpose);
    const boundaryScope = buildBoundaryScope(input);
    const base = input.mcpLevel
        ? {userId, boundaryScope, purpose, audience: [`mcp:${input.mcpLevel}`]}
        : {userId, boundaryScope, purpose};
    return {
        kind: 'fm_scoped_pat',
        previewMethod: 'User.PreviewScopedPAT',
        previewParams: {userId, boundaryScope},
        createMethod: 'User.CreateScopedPAT',
        createParams: withExpirationDays(base, expirationDays)
    };
}

export function buildBoundaryScope(
    input: Pick<ScopedPatCreateInput, 'scopeAll' | 'pickedScope'>
): Record<string, unknown> {
    const scope = buildScope(input.scopeAll, input.pickedScope);
    if (!scope) {
        throw new Error(
            'At least one scope dimension required (or pick "inherit all")'
        );
    }
    return scope as Record<string, unknown>;
}

function requireUserId(userId: string | undefined): string {
    const value = userId?.trim();
    if (!value) throw new Error('No target user selected.');
    return value;
}

function requirePurpose(purpose: string): string {
    const value = purpose.trim();
    if (!value) throw new Error('Purpose is required for scoped tokens');
    return value;
}

function parseExpirationDays(value: string): number | undefined {
    const days = Number.parseInt(value, 10);
    return days > 0 ? days : undefined;
}

function withExpirationDays<T extends Record<string, unknown>>(
    params: T,
    expirationDays: number | undefined
): T & {expirationDays?: number} {
    return expirationDays === undefined ? params : {...params, expirationDays};
}
