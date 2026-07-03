import type {ResourceId} from './ResourceRef';

export type ScopeFilterKind = 'unrestricted' | 'deny_all' | 'ids';

export interface ScopeFilter {
    kind: ScopeFilterKind;
    resourceType: string;
    ids?: ResourceId[];
    reason?: string;
}

export function unrestrictedScope(resourceType: string): ScopeFilter {
    return {kind: 'unrestricted', resourceType};
}

export function denyAllScope(
    resourceType: string,
    reason: string
): ScopeFilter {
    return {kind: 'deny_all', resourceType, reason};
}

export function idScope(
    resourceType: string,
    ids: readonly ResourceId[]
): ScopeFilter {
    return {kind: 'ids', resourceType, ids: [...ids]};
}
