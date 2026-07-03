// Resolves a kind id to a normalized entry via kindRepository (the one table
// source). Built-ins and the org's custom rows resolve the same way.

import * as kindRepository from './kindRepository';

export type KindAppliesTo = 'device' | 'group' | 'both';

export interface ResolvedKind {
    id: string;
    name: string;
    category: string;
    icon: string | null;
    appliesTo: KindAppliesTo;
    source: 'vendor' | 'custom';
}

// Injectable for tests; defaults read the kind table.
export interface KindResolverLoaders {
    loadKind(id: string, organizationId: string): Promise<ResolvedKind | null>;
    listKinds(
        organizationId: string,
        appliesTo: KindAppliesTo
    ): Promise<ResolvedKind[]>;
}

const defaultLoaders: KindResolverLoaders = {
    loadKind: kindRepository.loadKind,
    listKinds: kindRepository.listKinds
};

export async function resolveKind(
    id: string,
    organizationId: string,
    loaders: KindResolverLoaders = defaultLoaders
): Promise<ResolvedKind | null> {
    return loaders.loadKind(id, organizationId);
}

export async function listKindsFor(
    organizationId: string,
    appliesTo: KindAppliesTo,
    loaders: KindResolverLoaders = defaultLoaders
): Promise<ResolvedKind[]> {
    return loaders.listKinds(organizationId, appliesTo);
}
