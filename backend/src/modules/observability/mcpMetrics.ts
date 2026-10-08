import {getLogger} from 'log4js';
import {Counter, Histogram} from 'prom-client';
import type {McpReason} from '../ai/mcpErrors';
import {registry} from './registry';
import {getLevel} from './samplers';

export type McpToolOutcome = 'success' | 'error';
export type McpApprovalOutcome =
    | 'asked'
    | 'approved'
    | 'refused'
    | 'remembered';
// prompt = elicitation in the client; token = confirm-token preview; standing = a remembered yes.
export type McpApprovalChannel = 'prompt' | 'token' | 'standing';

const toolCalls = new Counter({
    name: 'fm_mcp_tool_calls_total',
    help: 'MCP tool calls by tool and outcome',
    labelNames: ['tool', 'outcome'] as const,
    registers: [registry]
});

const toolDuration = new Histogram({
    name: 'fm_mcp_tool_duration_seconds',
    help: 'MCP tool call wall duration in seconds',
    labelNames: ['tool'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 120],
    registers: [registry]
});

const denials = new Counter({
    name: 'fm_mcp_denials_total',
    help: 'MCP requests refused, by stable reason code',
    labelNames: ['reason'] as const,
    registers: [registry]
});

const budgetHits = new Counter({
    name: 'fm_mcp_rate_budget_exceeded_total',
    help: 'MCP calls refused by the per-user read or write budget',
    labelNames: ['kind'] as const,
    registers: [registry]
});

const approvals = new Counter({
    name: 'fm_mcp_approvals_total',
    help: 'MCP human approvals by outcome and channel',
    labelNames: ['outcome', 'channel'] as const,
    registers: [registry]
});

const logger = getLogger('observability');

// Well above the real tool list; a caller passing unchecked names folds into
// 'other' instead of growing one series per name.
const MAX_TOOL_LABELS = 64;
const TOOL_LABEL = /^[a-z][a-z0-9_]{0,63}$/;
const toolLabels = new Set<string>();

function toolLabel(tool: string): string {
    if (toolLabels.has(tool)) return tool;
    if (!TOOL_LABEL.test(tool)) return 'unknown';
    if (toolLabels.size >= MAX_TOOL_LABELS) {
        logger.error('MCP tool label cap reached; counting %s as other', tool);
        return 'other';
    }
    toolLabels.add(tool);
    return tool;
}

/** One finished tool call. Pass a registered tool name, else 'unknown'. */
export function recordMcpToolCall(
    tool: string,
    outcome: McpToolOutcome,
    durationMs: number
): void {
    if (getLevel() < 2) return;
    const label = toolLabel(tool);
    toolCalls.inc({tool: label, outcome});
    toolDuration.observe({tool: label}, Math.max(0, durationMs) / 1000);
}

export function recordMcpDenial(reason: McpReason): void {
    if (getLevel() < 2) return;
    denials.inc({reason});
}

export function recordMcpRateBudgetHit(kind: 'read' | 'write'): void {
    if (getLevel() < 2) return;
    budgetHits.inc({kind});
}

export function recordMcpApproval(
    outcome: McpApprovalOutcome,
    channel: McpApprovalChannel
): void {
    if (getLevel() < 2) return;
    approvals.inc({outcome, channel});
}
