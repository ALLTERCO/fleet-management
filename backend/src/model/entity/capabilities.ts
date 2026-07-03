// Entity-type registry — derived from self-registered composers.

import {
    getComposer,
    knownEntityTypes,
    shellyNamespaceForEntityType
} from './composerRegistry';
import {seedComposerRegistry} from './composerSeed';

seedComposerRegistry();

export const REGISTERED_ENTITY_TYPES: readonly string[] = Object.freeze([
    ...knownEntityTypes()
]);

export const ENTITY_TYPE_TO_SHELLY_COMPONENT: Readonly<Record<string, string>> =
    Object.freeze(buildEntityTypeNamespaceMap());

function buildEntityTypeNamespaceMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const type of knownEntityTypes()) {
        const ns = shellyNamespaceForEntityType(type);
        if (ns) out[type] = ns;
    }
    return out;
}

export function listRegisteredEntityTypes(): string[] {
    return [...REGISTERED_ENTITY_TYPES].sort();
}

export function shellyComponentForEntityType(type: string): string | undefined {
    return shellyNamespaceForEntityType(type);
}

export {getComposer, knownEntityTypes};
