// SoT for config + env reads across delivery adapters.

// Tolerant of unknown/null/non-object inputs — caller doesn't need to
// pre-check obj shape.
export function readString(obj: unknown, key: string): string {
    if (!obj || typeof obj !== 'object') return '';
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : '';
}

export function readNumber(obj: unknown, key: string): number | null {
    if (!obj || typeof obj !== 'object') return null;
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function envCred(name: string): string {
    return process.env[name]?.trim() ?? '';
}
