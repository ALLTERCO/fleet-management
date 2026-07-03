// Lazy PostgresProvider.callMethod with a test seam. The dynamic import
// breaks the config/index.ts TDZ so tests can inject a fake before any real
// DB call. createLazyPgCall() hands each store its own seam, so injecting in
// one store never leaks into another.

export type CallMethod = (
    name: string,
    params: Record<string, unknown>
) => Promise<{rows?: unknown[]} | undefined>;

export function createLazyPgCall(): {
    pgCall: CallMethod;
    setForTests: (impl: CallMethod | null) => void;
} {
    let impl: CallMethod | undefined;
    const pgCall: CallMethod = async (name, params) => {
        if (!impl) {
            const mod = await import('../PostgresProvider.js');
            impl = mod.callMethod;
        }
        return impl(name, params);
    };
    return {
        pgCall,
        setForTests: (fn) => {
            impl = fn ?? undefined;
        }
    };
}
