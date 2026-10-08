export function redactJsonString(
    value: string,
    redact: (value: unknown) => unknown,
    replacement: string
): string {
    if (!/^\s*[[{]/.test(value)) return value;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return value;
    }
    return JSON.stringify(redact(parsed)) === JSON.stringify(parsed)
        ? value
        : replacement;
}
