// OWASP API4/API8: normalize raw device error text to a fixed enum at the
// proxy boundary. Callers expose `{code, detail?}` to clients so error
// dispatch is programmable and free-form upstream text is never reflected.
const DETAIL_MAX_CHARS = 200;

export type DeviceErrorCode =
    | 'timeout'
    | 'unsupported'
    | 'invalid_params'
    | 'unreachable'
    | 'auth_required'
    | 'unknown';

export interface ClassifiedDeviceError {
    code: DeviceErrorCode;
    /** Safe, length-capped excerpt of the device's own message. Omitted when
     *  the upstream text isn't trustworthy enough to forward. */
    detail?: string;
}

const TIMEOUT_RE = /\b(timeout|timed?\s*out)\b/i;
const UNREACHABLE_RE =
    /\b(econnrefused|enotfound|ehostunreach|enetunreach|unreachable|offline|disconnected)\b/i;
const UNSUPPORTED_RE =
    /\b(method\s*not\s*(found|supported)|unsupported|unknown\s*method)\b/i;
const INVALID_RE =
    /\b(bad\s*arg(ument)?s?|invalid\s*(arg(ument)?s?|param(eter)?s?)|validation)\b/i;
const AUTH_RE =
    /\b(auth(entication|orization)?\s*(required|failed)|unauthorized|forbidden|401|403)\b/i;

export function classifyDeviceError(err: unknown): ClassifiedDeviceError {
    const message = extractMessage(err);
    const code = codeFor(err);
    const classified = classify(message, code);
    return classified.code === 'unknown'
        ? {code: 'unknown'}
        : {code: classified.code, detail: safeDetail(message)};
}

function extractMessage(err: unknown): string {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && 'message' in err) {
        const m = (err as {message: unknown}).message;
        return typeof m === 'string' ? m : '';
    }
    return '';
}

function codeFor(err: unknown): number | undefined {
    if (typeof err === 'object' && err !== null && 'code' in err) {
        const c = (err as {code: unknown}).code;
        return typeof c === 'number' ? c : undefined;
    }
    return undefined;
}

function classify(
    message: string,
    code: number | undefined
): {code: DeviceErrorCode} {
    // Shelly firmware: 404 = method not found, -105 = bad argument
    if (code === 404 || code === -32601) return {code: 'unsupported'};
    if (code === -105 || code === -32602) return {code: 'invalid_params'};
    if (code === 401 || code === 403) return {code: 'auth_required'};
    if (TIMEOUT_RE.test(message)) return {code: 'timeout'};
    if (UNREACHABLE_RE.test(message)) return {code: 'unreachable'};
    if (UNSUPPORTED_RE.test(message)) return {code: 'unsupported'};
    if (INVALID_RE.test(message)) return {code: 'invalid_params'};
    if (AUTH_RE.test(message)) return {code: 'auth_required'};
    return {code: 'unknown'};
}

function safeDetail(message: string): string | undefined {
    if (!message) return undefined;
    return message.length > DETAIL_MAX_CHARS
        ? `${message.slice(0, DETAIL_MAX_CHARS)}…`
        : message;
}

// Render a classified error to the stable wire string consumed by the device
// proxy's frontend (DeviceWebGuiModal). Format: "<code>" or "<code> — <detail>".
// Keeps the API surface flat so {{ error }} interpolation still works while
// guaranteeing no raw upstream text leaks past the enum prefix.
export function deviceErrorToWireString(err: unknown): string {
    const c = classifyDeviceError(err);
    return c.detail ? `${c.code} — ${c.detail}` : c.code;
}
