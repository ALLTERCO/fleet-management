/** Pure env-var readers — zero imports so any module can use them safely. */

// Rejection log; deduped per name so hot-path reads don't grow it.
const envRejections = new Map<string, string>();

export function takeEnvRejections(): string[] {
    const out = [...envRejections.values()];
    envRejections.clear();
    return out;
}

function recordRejection(name: string, raw: string, reason: string): void {
    if (envRejections.has(name)) return;
    envRejections.set(name, `${name}=${raw} rejected (${reason})`);
}

function optionalEnv(name: string): string | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function envInt(name: string, fallback: number, min = 1): number {
    const raw = optionalEnv(name);
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
        recordRejection(name, raw, `not an int >= ${min}`);
        return fallback;
    }
    return parsed;
}

export function envIntRange(
    name: string,
    fallback: number,
    min: number,
    max: number
): number {
    const raw = optionalEnv(name);
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        recordRejection(name, raw, `not an int in [${min}, ${max}]`);
        return fallback;
    }
    return parsed;
}

// `0` is a legitimate value — bounded range avoids falsy-coercion bugs.
export function envFloat(
    name: string,
    fallback: number,
    min: number,
    max: number
): number {
    const raw = optionalEnv(name);
    if (raw === undefined) return fallback;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        recordRejection(name, raw, `not a float in [${min}, ${max}]`);
        return fallback;
    }
    return parsed;
}

export function envStr(name: string, fallback: string): string {
    const raw = process.env[name]?.trim();
    return raw && raw.length > 0 ? raw : fallback;
}

export function envOptionalStr(name: string): string | undefined {
    return optionalEnv(name);
}

export function envBool(name: string, fallback: boolean): boolean {
    const raw = optionalEnv(name)?.toLowerCase();
    if (raw === undefined) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
}

export function envBoolRequired(name: string): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) throw new Error(`Required env var ${name} is not set`);
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    throw new Error(`Required env var ${name} must be a boolean`);
}

/** Required env — throws if unset or blank. Callers opt in per variable. */
export function envStrRequired(name: string): string {
    const raw = process.env[name]?.trim();
    if (!raw) throw new Error(`Required env var ${name} is not set`);
    return raw;
}

export function envIntRequired(name: string, min = 1): number {
    const raw = process.env[name];
    if (raw === undefined) {
        throw new Error(`Required env var ${name} is not set`);
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
        throw new Error(
            `Required env var ${name} must be an integer >= ${min}`
        );
    }
    return parsed;
}

export function envCsv(
    name: string,
    fallback: readonly string[]
): readonly string[] {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    if (raw.trim().length === 0) return [];
    const parsed = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : fallback;
}

// Numeric CSV — a non-numeric entry fails boot rather than silently
// changing a backoff/cooldown shape.
export function envIntCsv(
    name: string,
    fallback: readonly number[],
    min = 1
): readonly number[] {
    const raw = process.env[name];
    if (raw === undefined || raw.trim().length === 0) return fallback;
    const parsed = raw.split(',').map((s) => Number.parseInt(s.trim(), 10));
    if (parsed.length === 0) return fallback;
    for (const value of parsed) {
        if (!Number.isFinite(value) || value < min) {
            throw new Error(
                `Env var ${name} must be a CSV of integers >= ${min}`
            );
        }
    }
    return parsed;
}
