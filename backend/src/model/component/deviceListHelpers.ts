// Pure helpers; kept config-free so tests skip the config barrel.

import type AbstractDevice from '../AbstractDevice';

export function isNonEmptyFilters(
    filters: Record<string, any> | undefined
): filters is Record<string, any> {
    return (
        !!filters &&
        typeof filters === 'object' &&
        Object.keys(filters).length > 0
    );
}

function pickDeviceField(device: AbstractDevice, key: string): unknown {
    switch (key) {
        case 'shellyID':
            return device.shellyID;
        case 'id':
            return device.id;
        case 'source':
            return device.source ?? 'offline';
        case 'presence':
            return device.presence;
        default:
            return undefined;
    }
}

// Unknown filter keys empty the list (matches pre-refactor semantics).
export function applyFilters(
    devices: readonly AbstractDevice[],
    filters: Record<string, any>
): AbstractDevice[] {
    let out: AbstractDevice[] = [...devices];
    for (const key of Object.keys(filters)) {
        const value = filters[key];
        if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
        out = out.filter((d) => pickDeviceField(d, key) === value);
    }
    return out;
}

export interface PageSlice<T> {
    sliced: T[];
    rawLimit: number;
    offset: number;
}

// limitParam === 0 means unlimited (explicit opt-in).
export function sliceForPage<T>(
    items: readonly T[],
    total: number,
    limitParam: number | undefined,
    offsetParam: number | undefined,
    defaultLimit: number
): PageSlice<T> {
    const rawLimit = typeof limitParam === 'number' ? limitParam : defaultLimit;
    const limit = rawLimit === 0 ? total : rawLimit;
    const offset =
        typeof offsetParam === 'number' && offsetParam >= 0 ? offsetParam : 0;
    return {sliced: items.slice(offset, offset + limit), rawLimit, offset};
}

export function parseIncludeSet(include: unknown): Set<string> | undefined {
    if (!Array.isArray(include) || include.length === 0) return undefined;
    return new Set(include.filter((d): d is string => typeof d === 'string'));
}
