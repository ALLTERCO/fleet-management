// OWASP Logging Cheat Sheet — debug-log size cap to prevent log injection
// + cardinality explosion. Appends an explicit marker when truncated.

export function truncateForDebugLog(value: unknown, maxBytes: number): string {
    const json =
        typeof value === 'string' ? value : JSON.stringify(value ?? {});
    if (json.length <= maxBytes) return json;
    return `${json.slice(0, maxBytes)}…[truncated ${json.length - maxBytes}b]`;
}
