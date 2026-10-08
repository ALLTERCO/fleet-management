import type {McpRoleKey} from '@api/authzCatalog';
import {buildScope, type ScopeSelection} from './scopeDimensions';

// The picked boundary is any subset of the contract's scope dimensions —
// one shared type, defined in scopeDimensions.
export type PickedScopedPatBoundary = ScopeSelection;

export type McpKeyLevel = 'read' | 'write' | 'full';

/**
 * Which slice of the product an agent key works in. Orthogonal to the level:
 * the level is how much power, the role is where.
 *
 * Taken from the contract, not redeclared here. A role this UI offers that the
 * server does not know would mint a key that resolves to "invalid" and reaches
 * nothing at all, so the two lists must be one list.
 */
export type McpKeyRole = McpRoleKey;

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
    // Narrows the key to one work slice. Only meaningful alongside mcpLevel.
    mcpRole?: McpKeyRole;
    // Human label for the key, required for Zitadel PATs (stored FM-side).
    name?: string;
}

export type PatCreatePlan =
    | {
          kind: 'zitadel_pat';
          createMethod: 'User.CreatePAT';
          createParams: {
              userId: string;
              name: string;
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
        const base = {userId, name: requireName(input.name)};
        return {
            kind: 'zitadel_pat',
            createMethod: 'User.CreatePAT',
            createParams: withExpirationDays(base, expirationDays)
        };
    }
    const purpose = requirePurpose(input.purpose);
    const boundaryScope = buildBoundaryScope(input);
    // A role without a level would reach the MCP surface with no capability:
    // a key that can do nothing, which reads as a bug to whoever holds it.
    const audience = input.mcpLevel
        ? [
              `mcp:${input.mcpLevel}`,
              ...(input.mcpRole ? [`mcp.role:${input.mcpRole}`] : [])
          ]
        : undefined;
    const base = audience
        ? {userId, boundaryScope, purpose, audience}
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

function requireName(name: string | undefined): string {
    const value = name?.trim();
    if (!value) throw new Error('Key name is required');
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
