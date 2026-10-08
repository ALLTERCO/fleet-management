import type {ComponentName, CrudOperation} from '../../model/permissions';
import {
    AUTHZ_ACTIONS,
    AUTHZ_RESOURCE_BY_COMPONENT,
    foldAuthzAction
} from '../../types/api/authzCatalog';

export function authzResourceType(component: ComponentName): string {
    return AUTHZ_RESOURCE_BY_COMPONENT[component] ?? component;
}

export function authzAction(
    component: ComponentName,
    operation: CrudOperation
): string {
    return foldAuthzAction(authzResourceType(component), operation);
}

// The one list of actions the server checks lives in types/api/authzCatalog.ts.
export function enumerateActionVocabulary(): Set<string> {
    return new Set(AUTHZ_ACTIONS);
}

// A simulated action that does not exist would report a decision the runtime never honours.
export function assertKnownAuthzAction(action: string): void {
    if (!enumerateActionVocabulary().has(action)) {
        throw new Error(`Unknown authz action: ${action}`);
    }
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
