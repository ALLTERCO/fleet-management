// Single source of truth for the backend's role-key rule
// (backend/src/types/api/virtualdevice.ts ROLE_KEY_SCHEMA).

const PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidRoleKey(value: string): boolean {
    return PATTERN.test(value);
}

export function normalizeRoleKey(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^[^a-z]+/, '');
}
