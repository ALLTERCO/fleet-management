// Named WS close codes. App range 4000-4999 per RFC 6455.

export const CLOSE_AUTH_FAILED = 4401;
export const CLOSE_RATE_LIMITED = 4429;
export const CLOSE_REPLACED_BY_NEW_CONNECTION = 4001;
export const CLOSE_SERVER_OVERLOADED = 4503;

// Device endpoint (/shelly). Distinct codes from the client 4001 above so
// log aggregators don't conflate them.
export const CLOSE_DEVICE_INVALID_INIT = 4100;
export const CLOSE_DEVICE_INVALID_FRAME = 4101;

// RFC 6455 standard: retry later.
export const CLOSE_TRY_AGAIN_LATER = 1013;

export interface CloseTarget {
    close(code: number, reason?: string): void;
}

export function closeSocket(
    socket: CloseTarget,
    code: number,
    reason?: string
): void {
    socket.close(code, reason);
}
