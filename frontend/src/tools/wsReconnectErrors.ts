const RECOVERABLE_RECONNECT_MESSAGES = [
    'WebSocket closed',
    'RPC timeout after',
    'Failed to fetch',
    'NetworkError',
    'ERR_NETWORK'
];

export function isRecoverableReconnectError(error: unknown): boolean {
    const message = errorMessage(error);
    return RECOVERABLE_RECONNECT_MESSAGES.some((part) =>
        message.includes(part)
    );
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as {message?: unknown}).message);
    }
    return String(error);
}
