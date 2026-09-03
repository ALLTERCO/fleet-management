import {
    type ComponentName,
    CRUD_OPERATIONS,
    type CrudOperation
} from '../../model/permissions';
import {AUTHZ_RESOURCE_BY_COMPONENT} from '../../types/api/authzCatalog';

export function authzResourceType(component: ComponentName): string {
    return AUTHZ_RESOURCE_BY_COMPONENT[component] ?? component;
}

export function authzAction(
    component: ComponentName,
    operation: CrudOperation
): string {
    const resourceType = authzResourceType(component);
    // Devices: read / execute (control) / write (config umbrella over CUD).
    if (component === 'devices') {
        if (operation === 'read') return `${resourceType}:read`;
        if (operation === 'execute') return `${resourceType}:execute`;
        return `${resourceType}:write`;
    }
    return `${resourceType}:${operation}`;
}

/**
 * Throws unless `action` is one this policy vocabulary can actually emit.
 *
 * Callers that take an action from a client (the authz simulator) need this:
 * an unrecognised string is not "denied", it is unanswerable. Matched against
 * a persona holding a wildcard grant it comes back allowed, which is worse
 * than no answer at all.
 */
export function assertKnownAuthzAction(action: string): void {
    const vocabulary = enumerateActionVocabulary();
    if (vocabulary.has(action)) return;
    // Name a few real actions — the usual mistake is passing an RPC method
    // name (`admin.PostgresCall`) where a policy action (`device:read`) goes.
    const sample = [...vocabulary].slice(0, 3).join(', ');
    throw new Error(
        `unknown authz action '${action}' — expected a policy action such as ${sample}`
    );
}

// Actions authzAction() emits. Devices: read/execute/write only.
let cachedRealActions: Set<string> | undefined;

export function enumerateActionVocabulary(): Set<string> {
    if (cachedRealActions) return cachedRealActions;
    const out = new Set<string>();
    for (const component of Object.keys(
        AUTHZ_RESOURCE_BY_COMPONENT
    ) as ComponentName[]) {
        for (const op of CRUD_OPERATIONS) {
            out.add(authzAction(component, op));
        }
    }
    cachedRealActions = out;
    return out;
}

// Accepts '*', '<type>:*', '*:<verb>', '<type>:<verb>'. device:delete/update
// fold into write; device:execute is a real verb.
export function isKnownActionPattern(pattern: string): boolean {
    if (pattern === '*') return true;
    const parts = pattern.split(':');
    if (parts.length !== 2) return false;
    const [type, verb] = parts;
    if (!type || !verb) return false;
    const real = enumerateActionVocabulary();
    if (type === '*' && verb === '*') return true;
    if (type === '*') {
        // verb must appear in some real action.
        for (const action of real) if (action.endsWith(`:${verb}`)) return true;
        return false;
    }
    if (verb === '*') {
        // type must appear in some real action.
        for (const action of real)
            if (action.startsWith(`${type}:`)) return true;
        return false;
    }
    return real.has(pattern);
}
