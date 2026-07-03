import {createHash} from 'node:crypto';

export function sortForStableJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortForStableJson);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, sortForStableJson(nested)])
    );
}

export function stableJson(value: unknown): string {
    return JSON.stringify(sortForStableJson(value));
}

export function stableHash(value: unknown, length = 12): string {
    return createHash('sha256')
        .update(stableJson(value))
        .digest('hex')
        .slice(0, length);
}
