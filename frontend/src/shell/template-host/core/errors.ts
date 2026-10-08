// One normalized error shape for every Fleet SDK caller. Classification reuses
// @api/errors so there is no second copy of the code-to-category table.

import {
    categoryFor,
    describeErrors,
    type ErrorCategory,
    type FieldError
} from '@api/errors';

export type FleetSdkErrorCode = string;

export type FleetSdkError = {
    /** Stable identifier to branch on. Never a translated message. */
    code: FleetSdkErrorCode;
    /** The backend code exactly as received, when the failure carried one. */
    numericCode?: number;
    message: string;
    /** The RPC method that failed, when the transport reported it. */
    method?: string;
    /** One entry per input the backend refused, when it named any. */
    fieldErrors?: FieldError[];
    cause?: unknown;
    retryable: boolean;
    permissionDenied: boolean;
};

/** Raised by the paginator when the backend stops advancing through a list. */
export const FLEET_PAGINATION_NO_PROGRESS = 'FleetPaginationNoProgress';
/** Raised when a failure carries no code the SDK can classify. */
export const FLEET_UNKNOWN_ERROR = 'FleetUnknownError';

// HTTP statuses reach the client through the `/rpc` fallback transport, which
// rejects with `{code: res.status}`. They share the numeric space with nothing
// else the client sees, so they are classified before the domain table.
const HTTP_STATUS_CODES: Readonly<
    Record<number, {code: string; category: ErrorCategory}>
> = {
    401: {code: 'Unauthenticated', category: 'auth'},
    403: {code: 'PermissionDenied', category: 'permission'},
    404: {code: 'ResourceNotFound', category: 'not_found'},
    409: {code: 'Conflict', category: 'conflict'},
    429: {code: 'RateLimited', category: 'rate_limit'}
};

const RETRYABLE_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>(
    ['rate_limit', 'unavailable', 'server']
);

const DOMAIN_KIND_BY_CODE: ReadonlyMap<number, string> = new Map(
    describeErrors().map((descriptor) => [descriptor.code, descriptor.kind])
);

const LOWEST_DOMAIN_CODE = 1000;

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

/** Unwraps both `{code, message}` and JSON-RPC `{error: {code, message}}`. */
function readRpcPayload(cause: unknown): Record<string, unknown> | null {
    const outer = readRecord(cause);
    if (!outer) return null;
    if (typeof outer.code === 'number') return outer;
    const inner = readRecord(outer.error);
    return inner && typeof inner.code === 'number' ? inner : null;
}

function readMessage(cause: unknown, payload: Record<string, unknown> | null) {
    if (payload && typeof payload.message === 'string' && payload.message) {
        return payload.message;
    }
    if (cause instanceof Error && cause.message) return cause.message;
    if (typeof cause === 'string' && cause) return cause;
    return 'Fleet request failed';
}

// Drop entries missing the full {field, error, code} shape.
function readFieldErrors(
    payload: Record<string, unknown>
): FieldError[] | undefined {
    const data = readRecord(payload.data);
    const raw = data?.fieldErrors;
    if (!Array.isArray(raw)) return undefined;
    const parsed = raw.flatMap((entry) => {
        const record = readRecord(entry);
        if (!record) return [];
        const {field, error, code} = record;
        if (
            typeof field !== 'string' ||
            typeof error !== 'string' ||
            typeof code !== 'string'
        ) {
            return [];
        }
        return [{field, error, code}];
    });
    return parsed.length > 0 ? parsed : undefined;
}

function readMethod(cause: unknown): string | undefined {
    const outer = readRecord(cause);
    return typeof outer?.method === 'string' && outer.method
        ? outer.method
        : undefined;
}

function classify(numericCode: number): {
    code: string;
    category: ErrorCategory;
} {
    const httpStatus = HTTP_STATUS_CODES[numericCode];
    if (httpStatus) return httpStatus;
    if (numericCode >= 500 && numericCode < 600) {
        return {code: `Http${numericCode}`, category: 'server'};
    }
    const category = categoryFor(numericCode);
    const domainKind = DOMAIN_KIND_BY_CODE.get(numericCode);
    if (domainKind) return {code: domainKind, category};
    // Below the domain block and outside the HTTP range: a protocol code.
    const prefix = numericCode < LOWEST_DOMAIN_CODE ? 'Rpc' : 'Domain';
    return {code: `${prefix}${numericCode}`, category};
}

/** Normalizes any thrown value into the single SDK error shape. */
export function toFleetSdkError(cause: unknown): FleetSdkError {
    if (isFleetSdkError(cause)) return cause;
    const payload = readRpcPayload(cause);
    const message = readMessage(cause, payload);
    const method = readMethod(cause);
    if (!payload) {
        return readableError({
            code: FLEET_UNKNOWN_ERROR,
            message,
            ...(method ? {method} : {}),
            cause,
            retryable: false,
            permissionDenied: false
        });
    }
    const numericCode = payload.code as number;
    const {code, category} = classify(numericCode);
    const fieldErrors = readFieldErrors(payload);
    return readableError({
        code,
        numericCode,
        message,
        ...(method ? {method} : {}),
        ...(fieldErrors ? {fieldErrors} : {}),
        cause,
        retryable: RETRYABLE_CATEGORIES.has(category),
        permissionDenied: category === 'permission'
    });
}

/** Inputs the backend refused; empty when it named none. */
export function fleetSdkFieldErrors(cause: unknown): FieldError[] {
    return toFleetSdkError(cause).fieldErrors ?? [];
}

// `${error}` in a template renders the message, not "[object Object]".
// Non-enumerable so the error still compares as plain data in tests.
function readableError(error: FleetSdkError): FleetSdkError {
    Object.defineProperty(error, 'toString', {
        value: () => error.message,
        enumerable: false
    });
    return error;
}

/** The one sentence every template shows for a refused call. */
export const FLEET_PERMISSION_DENIED_MESSAGE =
    'You are not allowed to do this.';

/** Plain-language text for any caught failure, raw or normalized. */
export function fleetSdkErrorMessage(cause: unknown): string {
    const error = toFleetSdkError(cause);
    return error.permissionDenied
        ? FLEET_PERMISSION_DENIED_MESSAGE
        : error.message;
}

export function isFleetSdkError(value: unknown): value is FleetSdkError {
    const record = readRecord(value);
    return (
        record !== null &&
        typeof record.code === 'string' &&
        typeof record.message === 'string' &&
        typeof record.retryable === 'boolean' &&
        typeof record.permissionDenied === 'boolean'
    );
}

/** Builds an SDK-owned failure that did not originate at the backend. */
export function createFleetSdkError(
    code: FleetSdkErrorCode,
    message: string,
    details: {cause?: unknown; retryable?: boolean} = {}
): FleetSdkError {
    return readableError({
        code,
        message,
        ...(details.cause === undefined ? {} : {cause: details.cause}),
        retryable: details.retryable ?? false,
        permissionDenied: false
    });
}
