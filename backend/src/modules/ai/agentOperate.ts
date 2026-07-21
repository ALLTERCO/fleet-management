// One governed path for the agent ACTION policy: catalog resolution, the
// capability level (read/write/full), sensitive-namespace gating, the confirm
// flow, redaction, and per-call audit all live here, so MCP now and copilot/
// inbox/playbooks next share one implementation. Admission (auth, per-org
// enable/disable, client allowlist, rate budget) is the transport's job — the
// HTTP route today; a future non-HTTP caller must run the same admission gate
// before calling in. Returns plain objects; each transport shapes its envelope.

import type {RpcExecutor} from './liveTools.js';
import {McpError} from './mcpErrors.js';
import {claimToken, levelAllowsWrite, type McpLevel} from './mcpGovernance.js';
import {assertWritePolicy, catalogEntry, resolveFmMethod} from './mcpPolicy.js';
import {buildReadEnvelope, decodeCursor} from './readEnvelope.js';
import {
    signWriteConfirmation,
    verifyWriteConfirmation
} from './writeConfirmation.js';
import {assertParamsValid, buildWriteSummary} from './writeSummary.js';

export interface OperateCaller {
    username: string;
    organizationId: string | null;
}

export type OperateAudit = (entry: {
    tool: string;
    method?: string;
    success: boolean;
    errorMessage?: string;
    // 'prepare' = a preview that ran nothing; 'execute' = the mutation ran. So
    // the trail never reads an fm_write preview as if data changed.
    phase?: 'prepare' | 'execute';
}) => Promise<number | null>;

export interface OperateContext {
    execute: RpcExecutor;
    caller: OperateCaller;
    audit: OperateAudit;
    // Effective capability level (env ceiling ∩ tenant policy), resolved once by
    // the transport. Gates writes ('read' blocks them) and sensitive access
    // ('full' only).
    level: McpLevel;
}

function assertWritable(ctx: OperateContext): void {
    if (!levelAllowsWrite(ctx.level)) {
        throw new McpError(
            'read_only_mode',
            'MCP is read-only at this level; write tools are disabled',
            {tool: 'fm_write'}
        );
    }
}

export interface ReadRequest {
    method: string;
    params?: Record<string, unknown>;
    // Opaque cursor from a prior truncated read; resumes the method's offset.
    cursor?: string;
}

// A method pages by offset when its params schema declares an `offset` field.
function pagesByOffset(paramsSchema: unknown): boolean {
    const props = (paramsSchema as {properties?: Record<string, unknown>})
        ?.properties;
    return !!props && 'offset' in props;
}

export interface WriteRequest {
    method: string;
    params?: Record<string, unknown>;
    mode?: 'prepare' | 'execute';
}

// Run any read-only Fleet Manager method, bounded and redacted for an agent.
export async function operateRead(ctx: OperateContext, req: ReadRequest) {
    const method = resolveFmMethod({method: req.method}, 'read', ctx.level);
    const pageable = pagesByOffset(catalogEntry(method).paramsSchema);
    const params = {...(req.params ?? {})};
    let offset = Math.max(0, Number(params.offset) || 0);
    if (req.cursor !== undefined) {
        if (!pageable) {
            throw new McpError(
                'invalid_params',
                `${method} does not page; drop the cursor`,
                {tool: 'fm_read', method}
            );
        }
        offset = decodeCursor(req.cursor);
        params.offset = offset;
    }
    const result = await ctx.execute(method, params);
    await ctx.audit({tool: 'fm_read', method, success: true});
    return buildReadEnvelope(method, result, {offset, pageable});
}

// Server decides run-now vs preview; destructive writes always preview.
export async function operateWrite(ctx: OperateContext, req: WriteRequest) {
    assertWritable(ctx);
    const method = assertWritePolicy({method: req.method}, ctx.level);
    const params = req.params ?? {};
    const entry = catalogEntry(method);
    if (req.mode !== 'execute' || entry.safety.destructiveHint) {
        const reason =
            req.mode !== 'execute'
                ? 'preview requested'
                : 'destructive operation';
        // Build the preview first — it validates params and can throw — so a
        // bad preview never leaves a success audit behind.
        const preview = confirmationRequired(
            method,
            params,
            ctx.caller,
            reason
        );
        await ctx.audit({
            tool: 'fm_write',
            method,
            success: true,
            phase: 'prepare'
        });
        return preview;
    }
    assertParamsValid(method, params, entry.paramsSchema);
    return executeAndAudit(ctx, 'fm_write', method, params);
}

// Re-runs write policy (no bypass) and claims the token single-use, then runs.
export async function operateConfirm(
    ctx: OperateContext,
    confirmationToken: unknown
) {
    const action = verifyWriteConfirmation(confirmationToken, ctx.caller);
    assertWritable(ctx);
    assertWritePolicy({method: action.method}, ctx.level);
    claimToken(String(confirmationToken), action.expiresAtMs);
    return executeAndAudit(
        ctx,
        'fm_confirm_write',
        action.method,
        action.params
    );
}

// Preview + signed token; validates params first so no token for a bad action.
function confirmationRequired(
    method: string,
    params: Record<string, unknown>,
    caller: OperateCaller,
    reason: string
) {
    const entry = catalogEntry(method);
    assertParamsValid(method, params, entry.paramsSchema);
    const summary = buildWriteSummary(method, params);
    return {
        status: 'confirmation_required' as const,
        reason,
        method,
        params,
        summary: summary.title,
        reversible: summary.reversible,
        ...(summary.affected ? {affectedResources: summary.affected} : {}),
        requiredPermission: entry.permission,
        destructive: entry.safety.destructiveHint,
        paramsSchema: entry.paramsSchema,
        confirmationToken: signWriteConfirmation({
            method,
            params,
            username: caller.username,
            organizationId: caller.organizationId
        }),
        note: 'Call fm_confirm_write with this token to execute.'
    };
}

// Best-effort doorway audit before mutating. The batched audit queue does not
// reject in normal operation, so the refuse-on-throw here is a defensive
// backstop (e.g. a synchronous audit sink that fails), NOT a durability
// guarantee — "enqueued" means accepted by the queue, not persisted. Durable
// per-write audit is a tracked follow-up (see ai-mcp-operations.md).
async function recordWriteAuditOrRefuse(
    ctx: OperateContext,
    tool: string,
    method: string
) {
    try {
        await ctx.audit({tool, method, success: true, phase: 'execute'});
    } catch {
        throw new McpError(
            'audit_unavailable',
            `refusing to run ${method}: write audit could not be recorded`,
            {tool, method, retryable: true}
        );
    }
}

async function executeAndAudit(
    ctx: OperateContext,
    tool: string,
    method: string,
    params: Record<string, unknown>
) {
    await recordWriteAuditOrRefuse(ctx, tool, method);
    const result = await ctx.execute(method, params);
    // "enqueued" not "recorded": accepted by the batched queue, not persisted.
    return {
        status: 'executed' as const,
        method,
        result,
        audit: {enqueued: true}
    };
}
