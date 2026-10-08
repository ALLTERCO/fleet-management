// Stable, machine-readable MCP tool errors so agents recover on the reason
// code, not the human string. Reason codes match 04-mcp-toolsets.md.

export type McpReason =
    | 'not_authenticated'
    | 'permission_denied'
    | 'method_not_found'
    | 'method_not_read_only'
    | 'method_not_write'
    | 'namespace_not_allowed'
    | 'escape_hatch'
    // Hands out a secret, which would land in the AI provider's transcript.
    | 'issues_secret'
    | 'effect_depends_on_input'
    | 'sensitive_namespace'
    | 'read_only_mode'
    | 'client_not_allowed'
    | 'mcp_disabled'
    | 'rate_limited'
    | 'invalid_params'
    | 'invalid_confirmation'
    | 'audit_unavailable'
    | 'operation_unavailable'
    // The server stopped waiting. The work may still be in flight, so this is
    // never retryable for a write.
    | 'timeout'
    | 'unknown_tool'
    | 'parse_error'
    | 'invalid_request'
    | 'session_not_found'
    | 'resource_not_found'
    // The client withdrew the request; nothing more is sent for it.
    | 'cancelled'
    // An HTTP header disagrees with the body it mirrors, or is missing.
    | 'header_mismatch'
    | 'unsupported_protocol_version'
    // A multi round-trip retry carried state this server cannot accept.
    | 'invalid_request_state'
    // The request needs a capability or extension the client did not declare.
    | 'missing_required_client_capability';

export class McpError extends Error {
    readonly reason: McpReason;
    readonly method?: string;
    readonly tool?: string;
    readonly retryable: boolean;
    // Fields a protocol error must carry in `data`, such as the supported
    // versions of an UnsupportedProtocolVersionError.
    readonly details?: Record<string, unknown>;

    constructor(
        reason: McpReason,
        message: string,
        opts: {
            method?: string;
            tool?: string;
            retryable?: boolean;
            details?: Record<string, unknown>;
        } = {}
    ) {
        super(message);
        this.name = 'McpError';
        this.reason = reason;
        this.method = opts.method;
        this.tool = opts.tool;
        this.retryable = opts.retryable ?? false;
        this.details = opts.details;
    }
}

// Shape put on the JSON-RPC error object so clients read fields, not prose.
export function mcpErrorData(error: unknown) {
    if (!(error instanceof McpError)) return undefined;
    return {
        ...error.details,
        reason: error.reason,
        ...(error.method ? {method: error.method} : {}),
        ...(error.tool ? {tool: error.tool} : {}),
        retryable: error.retryable
    };
}

// Protocol-level reasons carry the code JSON-RPC and MCP assign to them; every
// other Fleet refusal is an implementation-defined server error (-32000).
const JSON_RPC_CODES: Partial<Record<McpReason, number>> = {
    parse_error: -32700,
    invalid_request: -32600,
    invalid_params: -32602,
    unknown_tool: -32602,
    // Same code the reference SDK server uses for an unknown session.
    session_not_found: -32001,
    resource_not_found: -32002,
    invalid_request_state: -32602,
    // Defined by 2026-07-28 in the range it reserves for the specification.
    header_mismatch: -32020,
    missing_required_client_capability: -32021,
    unsupported_protocol_version: -32022
};

const SERVER_ERROR = -32000;
const INTERNAL_ERROR = -32603;

/** The JSON-RPC error code for a failure; anything unplanned is internal. */
export function jsonRpcErrorCode(error: unknown): number {
    if (!(error instanceof McpError)) return INTERNAL_ERROR;
    return JSON_RPC_CODES[error.reason] ?? SERVER_ERROR;
}

/** One failed field, as a JSON Pointer (RFC 6901) into what was validated. */
export interface InvalidParam {
    pointer: string;
    code: string;
}

/**
 * The machine-readable part of a tool execution error. Pointers are relative
 * to the method's params when `method` is set, else to the tool arguments.
 */
export interface ToolErrorDetail {
    reason: McpReason | 'rpc_error' | 'tool_failed';
    retryable: boolean;
    rpcCode?: number;
    method?: string;
    tool?: string;
    invalidParams?: InvalidParam[];
}

function escapePointerToken(token: string): string {
    return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

// rpc/validation.ts names a field a.b[0].c, the whole value (root), and a
// range between two fields from..to.
function fieldPointers(field: string): string[] {
    if (field === '(root)' || field === '') return [''];
    return field
        .split('..')
        .map((side) =>
            [...side.matchAll(/\[(\d+)\]|([^.[\]]+)/g)]
                .map((match) => `/${escapePointerToken(match[1] ?? match[2])}`)
                .join('')
        );
}

function isFieldError(value: unknown): value is {field: string; code: string} {
    const entry = value as {field?: unknown; code?: unknown} | null;
    return typeof entry?.field === 'string' && typeof entry?.code === 'string';
}

// Field errors ride on McpError details or on an RPC error's data.
function fieldErrorsOf(error: unknown): unknown {
    if (error instanceof McpError) return error.details?.fieldErrors;
    return (error as {data?: {fieldErrors?: unknown}} | null)?.data
        ?.fieldErrors;
}

function invalidParamsOf(error: unknown): InvalidParam[] | undefined {
    const fieldErrors = fieldErrorsOf(error);
    if (!Array.isArray(fieldErrors)) return undefined;
    const params = fieldErrors
        .filter(isFieldError)
        .flatMap(({field, code}) =>
            fieldPointers(field).map((pointer) => ({pointer, code}))
        );
    return params.length > 0 ? params : undefined;
}

function rpcCodeOf(error: unknown): number | undefined {
    const code = (error as {code?: unknown} | null)?.code;
    return typeof code === 'number' ? code : undefined;
}

/** The structured detail a tool execution error carries next to its text. */
export function toolErrorDetail(error: unknown): ToolErrorDetail {
    const rpcCode = rpcCodeOf(error);
    const invalidParams = invalidParamsOf(error);
    const shared = {
        ...(rpcCode !== undefined ? {rpcCode} : {}),
        ...(invalidParams ? {invalidParams} : {})
    };
    if (!(error instanceof McpError)) {
        return {
            reason: rpcCode !== undefined ? 'rpc_error' : 'tool_failed',
            retryable: false,
            ...shared
        };
    }
    return {
        reason: error.reason,
        retryable: error.retryable,
        ...(error.method ? {method: error.method} : {}),
        ...(error.tool ? {tool: error.tool} : {}),
        ...shared
    };
}
