// Single helper for reading Vite env vars with safe fallback parsing.
// Keeps `import.meta.env.X` references out of business logic so tests can
// inject values and helpers stay framework-agnostic.

type EnvBag = Record<string, string | undefined>;

function envBag(): EnvBag {
    return (import.meta.env ?? {}) as unknown as EnvBag;
}

// Answer — env var as a number, falling back when missing/unparsable.
export function readEnvNumber(name: string, fallback: number): number {
    const raw = envBag()[name];
    if (raw == null || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// Answer — env var as a non-empty string, falling back when missing/empty.
export function readEnvString(name: string, fallback: string): string {
    const raw = envBag()[name];
    return raw != null && raw !== '' ? raw : fallback;
}

// Answer — env var as a boolean (1/true/yes), falling back when missing.
export function readEnvBool(name: string, fallback: boolean): boolean {
    const raw = envBag()[name];
    if (raw == null || raw === '') return fallback;
    const v = raw.toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}
