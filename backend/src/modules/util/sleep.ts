// Awaitable setTimeout. Timer is intentionally NOT unref'd — callers must
// stop their loops via a flag/AbortSignal, not via process exit.
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
