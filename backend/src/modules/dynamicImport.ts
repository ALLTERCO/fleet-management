export function unwrapDefaultExport<T>(mod: unknown): T {
    const maybeDefault = (mod as {default?: unknown}).default ?? mod;
    return ((maybeDefault as {default?: unknown}).default ?? maybeDefault) as T;
}
