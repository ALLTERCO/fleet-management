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
    | 'effect_depends_on_input'
    | 'sensitive_namespace'
    | 'read_only_mode'
    | 'client_not_allowed'
    | 'mcp_disabled'
    | 'rate_limited'
    | 'invalid_params'
    | 'invalid_confirmation'
    | 'audit_unavailable'
    | 'unknown_tool';

export class McpError extends Error {
    readonly reason: McpReason;
    readonly method?: string;
    readonly tool?: string;
    readonly retryable: boolean;

    constructor(
        reason: McpReason,
        message: string,
        opts: {method?: string; tool?: string; retryable?: boolean} = {}
    ) {
        super(message);
        this.name = 'McpError';
        this.reason = reason;
        this.method = opts.method;
        this.tool = opts.tool;
        this.retryable = opts.retryable ?? false;
    }
}

// Shape put on the JSON-RPC error object so clients read fields, not prose.
export function mcpErrorData(error: unknown) {
    if (!(error instanceof McpError)) return undefined;
    return {
        reason: error.reason,
        ...(error.method ? {method: error.method} : {}),
        ...(error.tool ? {tool: error.tool} : {}),
        retryable: error.retryable
    };
}
