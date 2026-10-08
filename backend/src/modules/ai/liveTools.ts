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
//
// The input schema is the RPC's own, taken from the catalog. Hand-written
// copies drift: read_energy advertised `required: [scope, from, to]` while
// energy.Query requires `[from, to, tags]`, so the minimal call the tool
// documented was rejected every single time — and the copy also silently
// dropped twelve real parameters, including groupBy, perDevice and pricing.

import type {JsonSchema} from '../../types/api/_schema.js';
import {McpError} from './mcpErrors.js';
import {catalogEntry, pagesByOffset} from './mcpPolicy.js';
import {assertToolInput} from './mcpToolInput.js';
import {buildReadEnvelope} from './readEnvelope.js';

export type RpcExecutor = (
    method: string,
    params: Record<string, unknown>
) => Promise<unknown>;

export interface LiveTool {
    name: string;
    title: string;
    description: string;
    rpcMethod: string;
}

export const LIVE_TOOLS: LiveTool[] = [
    {
        name: 'list_devices',
        title: 'List devices',
        description:
            'List fleet devices (slim, capability-filtered for the caller). Read-only; runs device.List as the authenticated user.',
        rpcMethod: 'device.List'
    },
    {
        name: 'read_energy',
        title: 'Read energy history',
        description:
            'Query aggregated energy history. Read-only; runs energy.Query as the authenticated user. Requires from, to and tags; see get_api_method("energy.Query") for the tag vocabulary.',
        rpcMethod: 'energy.Query'
    }
];

/** The RPC's own parameter schema — the single source of truth for both. */
function schemaFor(tool: LiveTool): JsonSchema {
    const schema = catalogEntry(tool.rpcMethod).paramsSchema;
    if (schema && typeof schema === 'object') {
        return schema as JsonSchema;
    }
    return {type: 'object', properties: {}};
}

export function liveToolDefinitions() {
    return LIVE_TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: schemaFor(tool),
        annotations: {readOnlyHint: true}
    }));
}

export async function callLiveTool(
    name: string,
    args: Record<string, unknown>,
    execute: RpcExecutor
) {
    const tool = LIVE_TOOLS.find((entry) => entry.name === name);
    if (!tool) {
        throw new McpError('unknown_tool', `Unknown live tool: ${name}`, {
            tool: name
        });
    }
    // Rejects a call the RPC would reject anyway, with a reason the agent can
    // act on rather than whatever the component happens to throw.
    assertToolInput({name: tool.name, inputSchema: schemaFor(tool)}, args);
    const entry = catalogEntry(tool.rpcMethod);
    const result = await execute(tool.rpcMethod, args);
    // Same envelope the generic fm_read uses: redacted, row- and byte-capped.
    // Without it these two tools were the one read path that returned raw,
    // unbounded rows straight to the model.
    // Paging matters here too: without it a truncated list_devices left the
    // agent with a partial fleet and no cursor to fetch the rest.
    const envelope = buildReadEnvelope(tool.rpcMethod, result, {
        offset: Math.max(0, Number(args.offset) || 0),
        pageable: pagesByOffset(entry.paramsSchema)
    });
    return {
        content: [{type: 'text', text: JSON.stringify(envelope)}],
        structuredContent: envelope as unknown as Record<string, unknown>
    };
}

export function isLiveTool(name: string): boolean {
    return LIVE_TOOLS.some((entry) => entry.name === name);
}
