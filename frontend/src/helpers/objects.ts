/**
 * Remove all keys from a reactive object, preserving its reference.
 * Useful for clearing Vue reactive({}) state without replacing the proxy.
 */
export function clearObject(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
        delete obj[key];
    }
}

/**
 * Promise-based sleep / delay.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
