// Dot-path helpers for the per-profile device-config form. The config
// editor stores values flat ("ws.enable", "wifi.sta.ssid") and ships
// them nested to the backend; isVarRef detects the ${VAR} template
// references the form uses for env-driven defaults.

// Answer — true if the value is a ${VAR} reference string. The picker
// renders these read-only with a "from environment" badge.
const VAR_REF_PATTERN = /\$\{[A-Za-z0-9_]+\}/;

export function isVarRef(value: unknown): boolean {
    return typeof value === 'string' && VAR_REF_PATTERN.test(value);
}

// Answer — value at a dot-path, or undefined if any segment is missing.
// Optional chaining traversal means partial paths fail soft instead of
// throwing on `undefined.foo`. Returns `any` because the config editor
// values are intentionally polymorphic and templates need to bind them
// directly without per-callsite casts.

// biome-ignore lint/suspicious/noExplicitAny: dynamic config form values.
export function getNestedValue(obj: unknown, path: string): any {
    return path.split('.').reduce<unknown>((acc, key) => {
        if (acc == null || typeof acc !== 'object') return undefined;
        return (acc as Record<string, unknown>)[key];
    }, obj);
}

// Do — set value at a dot-path, creating intermediate objects as needed.
// Mutates the input object in place; callers that need an immutable copy
// should clone first. write is bundled so the call site reads cleanly:
// setNestedValue(obj, {path: 'ws.enable', value: true}).
export function setNestedValue(
    obj: Record<string, unknown>,
    write: {path: string; value: unknown}
): void {
    const keys = write.path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce<Record<string, unknown>>((acc, key) => {
        if (!acc[key] || typeof acc[key] !== 'object') acc[key] = {};
        return acc[key] as Record<string, unknown>;
    }, obj);
    if (lastKey) target[lastKey] = write.value;
}

// Answer — expand a flat dot-keyed object into nested form. The reverse
// of the config-form's storage shape: backend wants {ws: {enable: true}}
// from the form's {"ws.enable": true}.
export function nestConfig(
    flat: Record<string, unknown>
): Record<string, unknown> {
    const nested: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(flat)) {
        setNestedValue(nested, {path, value});
    }
    return nested;
}
