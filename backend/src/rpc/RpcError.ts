import {createRequire} from 'node:module';
import {
    type DomainErrorKind,
    makeDomainError,
    type RpcErrorPayload
} from './errors';
import type {JsonRpcId, JsonRpcOutgoingError} from './types';

const requireFromRpcError = createRequire(__filename);

/**
 * Read `DEV_MODE` lazily via `require()` instead of a module-level import.
 *
 * A static `import {DEV_MODE} from '../config'` makes this file unloadable
 * in isolation — it pulls the config / plugin-loader TDZ graph into every
 * test that touches an RpcError instance. Moving the read into the error-
 * rendering path keeps the constructor, the factory methods, and module
 * load itself free of config dependencies, which in turn keeps the pure
 * v2 API layer (validation, Describe, action adapters, Energy.Query
 * handler) unit-testable without booting the backend.
 */
function devModeLazy(): boolean {
    try {
        const cfg = requireFromRpcError('../config');
        return !!cfg?.DEV_MODE;
    } catch {
        return false;
    }
}

const ERROR_CODES = {
    DEVICE_NOT_FOUND_ERROR: -32900,
    TIMEOUT_ERROR: -32800,
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    SERVER_ERROR: -32001,
    // Custom errors (outside JSON-RPC reserved range -32600..-32699)
    UNAUTHORIZED: -32000
};

export default class RpcError extends Error {
    private constructor(
        private readonly errorCode: number,
        private readonly errorMessage: string,
        private readonly errorData?: RpcErrorPayload['data']
    ) {
        super(errorMessage);

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RpcError);
        }
    }

    /** Numeric error code — stable across deploys; clients match on this. */
    get code(): number {
        return this.errorCode;
    }

    /** Structured payload (`field`, `details`) for domain errors, if any. */
    get data(): RpcErrorPayload['data'] {
        return this.errorData;
    }

    /**
     * Read a message from an unknown caught value: a string, an Error, a
     * `{message}` object, or a relay envelope `{error:{message}}`. undefined
     * when there is no real message so callers/factories pick their own
     * fallback. The one place the whole backend reads an error message.
     */
    static messageOf(cause: unknown): string | undefined {
        if (cause === undefined || cause === null) return undefined;
        if (typeof cause === 'string') return cause;
        if (cause instanceof Error) return cause.message;
        if (typeof cause === 'object') {
            const o = cause as {
                message?: unknown;
                error?: {message?: unknown};
            };
            if (typeof o.message === 'string') return o.message;
            if (o.message != null) return String(o.message);
            if (typeof o.error?.message === 'string') return o.error.message;
        }
        return String(cause);
    }

    /** JSON-RPC code from `{code}` or a relay envelope `{error:{code}}`. */
    static codeOf(cause: unknown): number | undefined {
        if (cause && typeof cause === 'object') {
            const o = cause as {code?: unknown; error?: {code?: unknown}};
            if (typeof o.code === 'number') return o.code;
            if (typeof o.error?.code === 'number') return o.error.code;
        }
        return undefined;
    }

    /** Device lacks the method — Shelly signals it by 404/-32601 code OR message. */
    static isMethodNotFound(cause: unknown): boolean {
        const code = RpcError.codeOf(cause);
        if (code === 404 || code === ERROR_CODES.METHOD_NOT_FOUND) return true;
        const msg = (RpcError.messageOf(cause) ?? '').toLowerCase();
        return (
            msg.includes('method not found') ||
            msg.includes('method not supported') ||
            msg.includes('unknown method')
        );
    }

    getErrorObject() {
        let trace: string[] | undefined;

        if (devModeLazy()) {
            if (this.stack) {
                trace = this.stack.split('\n');
            } else {
                trace = [
                    'Missing stack??',
                    'Someone threw a non-error object???'
                ];
            }
        }

        // Prefer the structured error data (domain errors) over the stack
        // trace — dev-mode debugging still has the trace under `_trace`.
        if (this.errorData !== undefined) {
            return {
                code: this.errorCode,
                message: this.errorMessage,
                data: trace
                    ? {...this.errorData, _trace: trace}
                    : this.errorData
            };
        }

        return {
            code: this.errorCode,
            message: this.errorMessage,
            data: trace
        };
    }

    getRpcError(id?: JsonRpcId, dst?: string) {
        return {
            id: id ?? null,
            src: 'FLEET_MANAGER',
            dst,
            error: this.getErrorObject()
        } satisfies JsonRpcOutgoingError;
    }

    static fromError(err: Error) {
        const error = new RpcError(ERROR_CODES.SERVER_ERROR, 'Internal error');
        error.stack = err.stack;
        return error;
    }

    /**
     * Build an RpcError from a registered domain error kind. The numeric
     * code, default message, and data payload all come from the registry
     * in `errors.ts` — this factory is the only path from a domain kind
     * to a thrown RpcError, so the registry stays the single source of
     * truth for codes, messages, and HTTP status mapping.
     */
    static Domain(
        kind: DomainErrorKind,
        override?: Parameters<typeof makeDomainError>[1]
    ): RpcError {
        const payload = makeDomainError(kind, override);
        return new RpcError(payload.code, payload.message, payload.data);
    }

    /**
     * Not-found helper — `ResourceNotFound` carrying the resource type
     * and optional identifier through `data.details`. Keeps the registry
     * small (one code for every "X not found") while giving the frontend
     * enough context to render resource-specific UX.
     */
    static NotFound(
        resourceType: string,
        identifier?: string | number
    ): RpcError {
        const details: Record<string, unknown> = {resourceType};
        if (identifier !== undefined) details.identifier = identifier;
        return RpcError.Domain('ResourceNotFound', {
            message: `${resourceType} not found`,
            details
        });
    }

    /**
     * Generic "operation failed" helper — `OperationFailed` with the
     * operation label and optional underlying cause in `data.details`.
     * Preserves the caught error message as the human-readable message.
     */
    static OperationFailed(operation: string, cause?: unknown): RpcError {
        const message = RpcError.messageOf(cause);
        return RpcError.Domain('OperationFailed', {
            message: message
                ? `${operation} failed: ${message}`
                : `${operation} failed`,
            operation,
            ...(message !== undefined ? {details: {cause: message}} : {})
        });
    }

    /**
     * Device-side failure helper — `DeviceOperationFailed`. The device is
     * the source of truth; its error message bubbles up unchanged so the
     * UI can render what the device actually said.
     */
    static DeviceFailed(
        operation: string,
        cause?: unknown,
        shellyID?: string
    ): RpcError {
        const deviceMessage = RpcError.messageOf(cause);
        const deviceCode = RpcError.codeOf(cause);
        const common = {
            operation,
            ...(shellyID !== undefined ? {shellyID} : {}),
            ...(deviceMessage !== undefined ? {deviceMessage} : {}),
            ...(deviceCode !== undefined ? {deviceCode} : {})
        };
        // Shelly firmware: 404 = method not found, -105 = bad argument
        const isMethodNotFound = RpcError.isMethodNotFound(cause);
        const isBadArgument =
            deviceCode === -105 || deviceCode === ERROR_CODES.INVALID_PARAMS;
        if (isMethodNotFound) {
            return RpcError.Domain('UnsupportedOperation', {
                message: `${operation} not supported by this device`,
                ...common
            });
        }
        if (isBadArgument) {
            return RpcError.Domain('ValidationFailed', {
                message: deviceMessage
                    ? `${operation}: ${deviceMessage}`
                    : `${operation} rejected by device`,
                ...common
            });
        }
        return RpcError.Domain('DeviceOperationFailed', {
            message: deviceMessage
                ? `${operation} failed: ${deviceMessage}`
                : `${operation} failed`,
            ...common
        });
    }

    /**
     * Service-unavailable helper — `ServiceUnavailable`. Use for
     * transient or configuration-driven unavailability (server shutting
     * down, mail transport not configured, telemetry channel missing).
     */
    static Unavailable(service: string, reason?: string): RpcError {
        const details: Record<string, unknown> = {service};
        if (reason !== undefined) details.reason = reason;
        return RpcError.Domain('ServiceUnavailable', {
            message: reason
                ? `${service} unavailable: ${reason}`
                : `${service} unavailable`,
            details
        });
    }

    static Timeout() {
        return new RpcError(ERROR_CODES.TIMEOUT_ERROR, 'Timeout');
    }

    static MethodNotFound() {
        return new RpcError(ERROR_CODES.METHOD_NOT_FOUND, 'Method not found');
    }

    static DeviceNotFound() {
        return new RpcError(
            ERROR_CODES.DEVICE_NOT_FOUND_ERROR,
            'Device not found.'
        );
    }

    static Server(message: string) {
        return new RpcError(ERROR_CODES.SERVER_ERROR, message);
    }

    static InvalidRequest(message?: string) {
        return new RpcError(
            ERROR_CODES.INVALID_REQUEST,
            message ?? 'Invalid request'
        );
    }

    static InvalidParams(
        message?: string,
        fieldErrors?: import('./errors').FieldError[]
    ) {
        const data =
            fieldErrors && fieldErrors.length > 0 ? {fieldErrors} : undefined;
        return new RpcError(
            ERROR_CODES.INVALID_PARAMS,
            message ?? 'Invalid Params',
            data
        );
    }

    static Unauthorized() {
        return new RpcError(ERROR_CODES.UNAUTHORIZED, 'Unauthorized');
    }

    // A permission denial: 403 PermissionDenied for an authenticated caller,
    // 401 Unauthorized when no identity was presented. Single home for the
    // 401-vs-403 mapping so every gate stays consistent.
    static PermissionDenied(authenticated: boolean) {
        return authenticated
            ? RpcError.Domain('PermissionDenied')
            : RpcError.Unauthorized();
    }
}
