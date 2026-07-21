// Phase A live-read MCP tools: a few goal-oriented tools that run real
// read-only RPCs as the authenticated user. Curated on purpose (not one
// tool per method) — Cloudflare/Anthropic guidance. Every tool wraps a
// method the catalog marks read-only; a test enforces that, so a live
// tool can never be pointed at a write.
//
// Execution reuses the normal RPC path (handleInternalCommands →
// CommandSender → component permission decorators), so authorization is
// deny-by-default and never reimplemented here. The executor is supplied
// by the /mcp route, bound to the request's user.

export type RpcExecutor = (
    method: string,
    params: Record<string, unknown>
) => Promise<unknown>;

export interface LiveTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    rpcMethod: string;
    /** Map validated tool args to RPC params. Read-only by construction. */
    toParams: (args: Record<string, unknown>) => Record<string, unknown>;
}

export const LIVE_TOOLS: LiveTool[] = [
    {
        name: 'list_devices',
        description:
            'List fleet devices (slim, capability-filtered for the caller). Read-only; runs device.list as the authenticated user.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {type: 'integer', minimum: 1, maximum: 500},
                offset: {type: 'integer', minimum: 0}
            }
        },
        rpcMethod: 'device.List',
        toParams: (args) => ({
            ...(typeof args.limit === 'number' ? {limit: args.limit} : {}),
            ...(typeof args.offset === 'number' ? {offset: args.offset} : {})
        })
    },
    {
        name: 'read_energy',
        description:
            'Query aggregated energy history for a scope (device/group). Read-only; runs energy.Query as the authenticated user.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: {type: 'object'},
                from: {type: 'string'},
                to: {type: 'string'},
                bucket: {type: 'string'},
                tags: {type: 'array', items: {type: 'string'}}
            },
            required: ['scope', 'from', 'to']
        },
        rpcMethod: 'energy.Query',
        toParams: (args) => ({
            scope: args.scope,
            from: args.from,
            to: args.to,
            ...(args.bucket ? {bucket: args.bucket} : {}),
            ...(Array.isArray(args.tags) ? {tags: args.tags} : {})
        })
    }
];

export function liveToolDefinitions() {
    return LIVE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {readOnlyHint: true}
    }));
}

export async function callLiveTool(
    name: string,
    args: Record<string, unknown>,
    execute: RpcExecutor
) {
    const tool = LIVE_TOOLS.find((entry) => entry.name === name);
    if (!tool) throw new Error(`Unknown live tool: ${name}`);
    const result = await execute(tool.rpcMethod, tool.toParams(args));
    return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
}

export function isLiveTool(name: string): boolean {
    return LIVE_TOOLS.some((entry) => entry.name === name);
}
