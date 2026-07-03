// Fail-closed: a plugin RPC call is allowed only if the method appears
// (case-insensitive) in its declared allowlist; missing/malformed denies all.
// A plugin may opt into full access by declaring "*" in its own allowlist —
// an explicit, per-plugin choice visible in its manifest (for trusted plugins).
export function isMethodAllowed(allowlist: unknown, method: unknown): boolean {
    if (typeof method !== 'string' || method.length === 0) return false;
    if (!Array.isArray(allowlist)) return false;
    const allowed = new Set(
        allowlist
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.toLowerCase())
    );
    if (allowed.has('*')) return true;
    return allowed.has(method.toLowerCase());
}
