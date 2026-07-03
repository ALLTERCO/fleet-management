// Typed property readers for entity_t.properties. The properties bag is
// intentionally polymorphic in the type union (every entity kind extends
// it differently) so reading it requires per-call narrowing — these
// helpers centralise the narrow + typeof checks.

import type {entity_t} from '@/types';

// Answer — the raw properties bag as an indexable object.
export function entityProps(entity: entity_t): Record<string, unknown> {
    return entity.properties as Record<string, unknown>;
}

// Answer — string property at key, or undefined when missing or wrong type.
export function entityStringProp(
    entity: entity_t,
    key: string
): string | undefined {
    const value = entityProps(entity)[key];
    return typeof value === 'string' ? value : undefined;
}

// Answer — number property at key, or undefined when missing or wrong type.
export function entityNumericProp(
    entity: entity_t,
    key: string
): number | undefined {
    const value = entityProps(entity)[key];
    return typeof value === 'number' ? value : undefined;
}

// Answer — boolean property at key, or undefined when missing or wrong type.
export function entityBooleanProp(
    entity: entity_t,
    key: string
): boolean | undefined {
    const value = entityProps(entity)[key];
    return typeof value === 'boolean' ? value : undefined;
}

// Answer — string-list property at key, with non-string entries dropped.
// Returns an empty array on missing/wrong type so callers can iterate
// directly without a null check.
export function entityStringListProp(entity: entity_t, key: string): string[] {
    const value = entityProps(entity)[key];
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}
