// Stack on Error, message fallback, String() for thrown non-Errors.
// Use in `logger.error(...)` so post-mortems get the real call site.
export function formatError(err: unknown): string {
    if (err instanceof Error) return err.stack ?? err.message;
    return String(err);
}
