// OWASP Logging Cheat Sheet: never log full Error stacks at info+/error
// in production. truncateErrorForLog yields {name, message, code} only.

export interface TruncatedError {
    name: string;
    message: string;
    code?: string | number;
}

export function truncateErrorForLog(
    err: unknown,
    maxLen = 500
): TruncatedError {
    if (err instanceof Error) {
        const out: TruncatedError = {
            name: err.name,
            message: err.message.slice(0, maxLen)
        };
        const code = (err as {code?: unknown}).code;
        if (typeof code === 'string' || typeof code === 'number') {
            out.code = code;
        }
        return out;
    }
    if (typeof err === 'string') {
        return {name: 'string', message: err.slice(0, maxLen)};
    }
    return {name: 'unknown', message: String(err).slice(0, maxLen)};
}
