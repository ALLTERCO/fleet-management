// Scoped-token method registry + synthetic-user builder. Components mark
// methods with @AcceptsScopedToken('<purpose>'); the HTTP middleware
// consults the registry to decide whether a Bearer scoped token may be
// consumed for a given RPC.

import {
    type ComponentName,
    CRUD_OPERATIONS,
    type CrudOperation
} from '../../model/permissions';
import type {user_t} from '../../types';
import {authzAction} from '../authz/actionMap';
import type {EffectiveShape} from '../authz/types';
import type {ScopedTokenRow} from './scopedTokenRepo';

const methodPurpose: Map<string, string> = new Map();

export function registerScopedTokenMethod(
    method: string,
    purpose: string
): void {
    methodPurpose.set(method.toLowerCase(), purpose);
}

export function getScopedTokenPurpose(method: string): string | undefined {
    return methodPurpose.get(method.toLowerCase());
}

export function clearScopedTokenMethodsForTest(): void {
    methodPurpose.clear();
}

interface ParsedPurpose {
    component: ComponentName;
    operation: CrudOperation;
}

const CRUD_OPERATION_SET: ReadonlySet<CrudOperation> = new Set(CRUD_OPERATIONS);

export function parsePurpose(purpose: string): ParsedPurpose | undefined {
    const dot = purpose.indexOf('.');
    if (dot <= 0 || dot === purpose.length - 1) return undefined;
    const component = purpose.slice(0, dot) as ComponentName;
    const operation = purpose.slice(dot + 1) as CrudOperation;
    if (!CRUD_OPERATION_SET.has(operation)) return undefined;
    return {component, operation};
}

// One Allow statement granting exactly the action the purpose maps to,
// scoped to the entire org (further org-binding happens via user.organizationId).
export function shapeForPurpose(purpose: string): EffectiveShape {
    const parsed = parsePurpose(purpose);
    if (!parsed) return {statements: []};
    const action = authzAction(parsed.component, parsed.operation);
    const resourceType = action.split(':')[0];
    return {
        statements: [
            {
                actions: [action],
                resourceTypes: [resourceType],
                scope: {all: true},
                effect: 'Allow'
            }
        ]
    };
}

// Synthetic user pinned to the token's org. organizationId narrows tenant scope;
// effectiveShape carries the single granted action so CommandSender skips DB load.
export function userForScopedToken(row: ScopedTokenRow): user_t {
    return {
        username: `scoped-token:${row.purpose}`,
        password: '',
        permissions: [],
        group: 'scoped_token',
        enabled: true,
        roles: ['none'],
        organizationId: row.organization_id,
        userId: `scoped-token:${row.token_hash}`,
        tenantPinned: true,
        credentialPurpose: row.purpose,
        effectiveShape: shapeForPurpose(row.purpose)
    };
}
