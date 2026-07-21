export function bluStableIdFromAddress(value: string | null): string | null {
    if (!value) return null;
    const stableId = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
    return stableId.length === 12 ? stableId : null;
}

export function normalizeBleAddress(value: string): string {
    const stableId = bluStableIdFromAddress(value);
    if (!stableId) return value.toLowerCase();
    return stableId.match(/.{1,2}/g)?.join(':') ?? value.toLowerCase();
}

export function bluExternalIdFromAddress(value: string | null): string | null {
    const stableId = bluStableIdFromAddress(value);
    return stableId ? `blu_${stableId}` : null;
}
