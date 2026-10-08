// One governed path for the agent ACTION policy: catalog resolution, the
// capability level (read/write/full), sensitive-namespace gating, the confirm
// flow, redaction, and per-call audit all live here, so MCP now and copilot/
// inbox/playbooks next share one implementation. Admission (auth, per-org
// enable/disable, client allowlist, rate budget) is the transport's job — the
// HTTP route today; a future non-HTTP caller must run the same admission gate
// before calling in. Returns plain objects; each transport shapes its envelope.

import {getLogger} from 'log4js';
import type {
    McpApprovalChannel,
    McpApprovalOutcome
} from '../observability/mcpMetrics.js';
import type {RpcExecutor} from './liveTools.js';
import {
    grantStandingApproval,
    hasStandingApproval,
    type StandingApprovalTarget,
    standingApprovalTarget
} from './mcpApprovals.js';
import type {RememberScope} from './mcpElicit.js';
import {McpError} from './mcpErrors.js';
import {
    acquireDeviceCommandSlot,
    allowsStandingApproval,
    automationApprovalBinding,
    claimToken,
    type DeviceCommandClass,
    type DeviceCommandSlot,
    isAutomationWrite,
    isCredentialMethod,
    levelAllowsWrite,
    type McpLevel,
    recordMcpMetric,
    requiresHumanApproval,
    UNCOUNTED_DEVICE_COMMAND
} from './mcpGovernance.js';
import {
    assertWritePolicy,
    catalogEntry,
    pagesByOffset,
    resolveFmMethod,
    unwrapDeviceCall
} from './mcpPolicy.js';
import type {McpRoleSelection} from './mcpRoles.js';
import {executeDurableOperation} from './operationExecution.js';
import type {OperationStore} from './operationStore.js';
import {
    buildReadEnvelope,
    decodeCursor,
    untrustedMarker
} from './readEnvelope.js';
import type {OperateCaller} from './types.js';
import {
    signWriteConfirmation,
    verifyWriteConfirmation
} from './writeConfirmation.js';
import {
    assertParamsValid,
    buildWriteSummary,
    type WriteSummary,
    type WriteTarget
} from './writeSummary.js';

const logger = getLogger('mcpOperate');

export type {OperateCaller};

export type OperateAudit = (entry: {
    tool: string;
    method?: string;
    success: boolean;
    errorMessage?: string;
    // 'prepare' = a preview that ran nothing; 'execute' = the mutation ran. So
    // the trail never reads an fm_write preview as if data changed.
    phase?: 'prepare' | 'execute';
}) => Promise<number | null>;

// Asks the human, through the client, and returns what they said. Supplied by
// the transport only when the connected client declared the `elicitation`
// capability; absent otherwise, and the confirm-token flow carries the load.
export type OperateElicit = ((request: {
    message: string;
    method: string;
    destructive: boolean;
    // False for actions no standing approval may cover. The prompt then omits
    // the "stop asking" choice entirely, rather than offering a button that
    // silently does nothing.
    allowRemember: boolean;
}) => Promise<{approved: boolean; remember: RememberScope}>) & {
    // A retry bringing the answer to a question an earlier request asked.
    readonly answersRetry?: boolean;
};

export interface OperateContext {
    execute: RpcExecutor;
    caller: OperateCaller;
    audit: OperateAudit;
    // Effective capability level (env ceiling ∩ tenant policy), resolved once by
    // the transport. Gates writes ('read' blocks them) and sensitive access
    // ('full' only).
    level: McpLevel;
    elicit?: OperateElicit;
    operations?: OperationStore;
    /**
     * Which slice of the product this key works in. Orthogonal to the level:
     * the level is how much power, the role is where. Null means unrestricted,
     * which is every key that predates the feature.
     */
    role?: McpRoleSelection;
    // Aborted when the client cancels the request; no write starts after it.
    signal?: AbortSignal;
}

function assertNotCancelled(ctx: OperateContext): void {
    if (ctx.signal?.aborted) {
        throw new McpError('cancelled', 'The client cancelled this request', {
            retryable: false
        });
    }
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

export interface WriteRequest {
    method: string;
    params?: Record<string, unknown>;
    mode?: 'prepare' | 'execute';
    idempotencyKey?: string;
}

// Run any read-only Fleet Manager method, bounded and redacted for an agent.
export async function operateRead(ctx: OperateContext, req: ReadRequest) {
    // A device.Call tunnel is rewritten into the method it names, so the
    // policy judges the real action rather than the envelope.
    const unwrapped = unwrapDeviceCall(req);
    const method = resolveFmMethod(
        {method: unwrapped.method},
        'read',
        ctx.level,
        ctx.role ?? null
    );
    const pageable = pagesByOffset(catalogEntry(method).paramsSchema);
    const params = {...unwrapped.params};
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
    const slot = await deviceCommandSlot(ctx, method, 'read');
    const result = await holdingSlot(slot, () => ctx.execute(method, params));
    await ctx.audit({tool: 'fm_read', method, success: true});
    return buildReadEnvelope(method, result, {offset, pageable});
}

// Server decides run-now vs preview; destructive, credential and automation
// writes always ask a human first.
export async function operateWrite(ctx: OperateContext, req: WriteRequest) {
    assertWritable(ctx);
    if (
        req.idempotencyKey !== undefined &&
        (typeof req.idempotencyKey !== 'string' ||
            !req.idempotencyKey.trim() ||
            req.idempotencyKey.length > 4096)
    ) {
        throw new McpError(
            'invalid_params',
            'idempotencyKey must be a nonempty string of at most 4096 characters'
        );
    }
    const unwrapped = unwrapDeviceCall(req);
    const method = assertWritePolicy(
        {method: unwrapped.method},
        ctx.level,
        ctx.role ?? null
    );
    const params = unwrapped.params;
    if (req.idempotencyKey !== undefined && isCredentialMethod(method)) {
        throw new McpError(
            'invalid_params',
            'Credential issuance requires synchronous execution so the one-time secret is returned directly'
        );
    }
    const entry = catalogEntry(method);
    // An explicit preview always previews, even when a human already approved
    // this action: prepare means "show me", never "do it".
    if (req.mode !== 'execute') {
        if (requiresHumanApproval({method, params}, entry.safety)) {
            await noteApproval('asked', 'token');
        }
        const preview = confirmationRequired(
            method,
            params,
            ctx.caller,
            'preview requested',
            await resolveWriteTarget(ctx, params),
            req.idempotencyKey
        );
        await ctx.audit({
            tool: 'fm_write',
            method,
            success: true,
            phase: 'prepare'
        });
        return preview;
    }
    if (requiresHumanApproval({method, params}, entry.safety)) {
        const decided = await resolveApproval(
            ctx,
            method,
            params,
            entry,
            req.idempotencyKey
        );
        if (decided !== 'approved') return decided;
    }
    assertParamsValid(method, params, entry.paramsSchema);
    return executeAndAudit(
        ctx,
        {tool: 'fm_write', method, params, idempotencyKey: req.idempotencyKey},
        await deviceCommandSlot(ctx, method, 'write')
    );
}

/**
 * Turns the id in the params into something an operator recognises.
 *
 * "Install firmware on 34945475a4bc" is not reviewable: nobody can tell which
 * site that is, what it runs, or whether it is already offline. This is a
 * read, run as the same user, so RBAC still applies and a caller who cannot
 * see the device simply gets no extra detail.
 *
 * Best effort by design. A preview must never fail because the lookup did.
 */
async function resolveWriteTarget(
    ctx: OperateContext,
    params: Record<string, unknown>
): Promise<WriteTarget | undefined> {
    // A bulk action: name every device, so one prompt is still reviewable.
    if (Array.isArray(params.shellyIDs)) {
        const ids = (params.shellyIDs as unknown[]).map(String);
        const devices = await Promise.all(
            ids.map(async (externalId) => {
                try {
                    const d = (await ctx.execute('device.Get', {
                        shellyID: externalId
                    })) as {name?: string; displayName?: string} | undefined;
                    return {
                        externalId,
                        name: d?.displayName || d?.name
                    };
                } catch {
                    return {externalId};
                }
            })
        );
        return {devices};
    }
    const shellyID = params.shellyID ?? params.deviceExternalId;
    if (typeof shellyID !== 'string' || !shellyID) return undefined;
    try {
        const device = (await ctx.execute('device.Get', {shellyID})) as
            | {
                  name?: string;
                  displayName?: string;
                  presence?: string;
                  location?: {name?: string};
                  locationName?: string;
              }
            | undefined;
        if (!device) return undefined;
        const name = device.displayName || device.name;
        if (!name) return undefined;
        return {
            name,
            location: device.location?.name || device.locationName,
            online: device.presence
                ? device.presence.toLowerCase() === 'online'
                : undefined
        };
    } catch {
        // No permission, offline, gone — the write preview still has to render.
        return undefined;
    }
}

// Decides how a destructive execute gets its human sign-off. Three routes, in
// order of preference:
//   1. a standing approval the human already gave for this exact action;
//   2. an elicitation, when the connected client can show a prompt;
//   3. the confirm-token preview, which every client supports.
// Returns 'approved' to proceed, or the envelope to hand back to the agent.
async function resolveApproval(
    ctx: OperateContext,
    method: string,
    params: Record<string, unknown>,
    entry: ReturnType<typeof catalogEntry>,
    idempotencyKey?: string
): Promise<'approved' | Record<string, unknown>> {
    // Validate before asking: never prompt a human about an action that could
    // not run anyway.
    assertParamsValid(method, params, entry.paramsSchema);
    const target = allowsStandingApproval(method)
        ? standingApprovalTarget(ctx.caller, method, params)
        : undefined;
    const remembering = target !== undefined;
    if (target && (await hasStandingApproval(target))) {
        await noteApproval('remembered', 'standing');
        await ctx.audit({
            tool: 'fm_write',
            method,
            success: true,
            phase: 'prepare'
        });
        return 'approved';
    }
    if (!ctx.elicit) {
        const preview = confirmationRequired(
            method,
            params,
            ctx.caller,
            approvalReason(method, params),
            await resolveWriteTarget(ctx, params),
            idempotencyKey
        );
        await noteApproval('asked', 'token');
        await ctx.audit({
            tool: 'fm_write',
            method,
            success: true,
            phase: 'prepare'
        });
        return preview;
    }
    const summary = buildWriteSummary(
        method,
        params,
        entry.safety,
        await resolveWriteTarget(ctx, params)
    );
    const answer = await askHuman(ctx.elicit, {
        message: approvalMessage({method, params, summary, remembering}),
        method,
        destructive: !summary.reversible,
        allowRemember: remembering
    });
    // A withdrawn prompt reads as a refusal; record it as the cancel it was.
    assertNotCancelled(ctx);
    if (!answer.approved) {
        await noteApproval('refused', 'prompt');
        await ctx.audit({
            tool: 'fm_write',
            method,
            success: false,
            errorMessage: 'declined by user',
            phase: 'prepare'
        });
        return {
            status: 'declined',
            reason: 'declined by user',
            method,
            params
        };
    }
    await noteApproval('approved', 'prompt');
    if (target && answer.remember !== 'none') {
        await rememberApproval(target, answer.remember);
    }
    await ctx.audit({
        tool: 'fm_write',
        method,
        success: true,
        phase: 'prepare'
    });
    return 'approved';
}

// Counts each question once, when it is put to the human.
async function askHuman(
    elicit: OperateElicit,
    request: Parameters<OperateElicit>[0]
): ReturnType<OperateElicit> {
    if (!elicit.answersRetry) {
        await noteApproval('asked', 'prompt');
        return elicit(request);
    }
    try {
        return await elicit(request);
    } catch (error) {
        // The answer did not fit this prompt, so the question went out again.
        await noteApproval('asked', 'prompt');
        throw error;
    }
}

function noteApproval(
    outcome: McpApprovalOutcome,
    channel: McpApprovalChannel
): Promise<void> {
    return recordMcpMetric((metrics) =>
        metrics.recordMcpApproval(outcome, channel)
    );
}

// The human already approved this. Failing to REMEMBER that must never cancel
// it: a full or unreachable store only means the next call asks again.
async function rememberApproval(
    target: StandingApprovalTarget,
    scope: 'ttl' | 'forever'
): Promise<void> {
    try {
        const outcome = await grantStandingApproval(target, scope);
        if (!outcome.stored) {
            logger.warn(
                'standing approval not stored for %s: %s',
                target.method,
                outcome.reason
            );
        }
    } catch (error) {
        logger.warn(
            'standing approval not stored for %s: %s',
            target.method,
            error instanceof Error ? error.message : String(error)
        );
    }
}

// Why a human is asked, in the words the agent gets back.
function approvalReason(
    method: string,
    params: Record<string, unknown>
): string {
    if (isCredentialMethod(method)) return 'issues access or admits a device';
    if (isAutomationWrite(method, params)) {
        return 'starts or changes an automation';
    }
    return 'destructive operation';
}

// The prompt text: the summary, its detail lines, and what "stop asking" covers
// when that is wider than this one exact action.
function approvalMessage(prompt: {
    method: string;
    params: Record<string, unknown>;
    summary: WriteSummary;
    remembering: boolean;
}): string {
    const {method, params, summary, remembering} = prompt;
    const lines = [
        summary.reversible
            ? summary.title
            : `${summary.title} This cannot be undone.`,
        ...(summary.details ?? [])
    ];
    if (remembering && isAutomationWrite(method, params)) {
        lines.push(
            automationApprovalBinding(method)?.length === 0
                ? 'If you stop asking, every new automation this AI creates runs without asking, whatever it contains.'
                : 'If you stop asking, later changes to this same automation run without asking.'
        );
    }
    return lines.join('\n');
}

// Re-runs write policy (no bypass) and claims the token single-use, then runs.
export async function operateConfirm(
    ctx: OperateContext,
    confirmationToken: unknown
) {
    const action = verifyWriteConfirmation(confirmationToken, ctx.caller);
    assertWritable(ctx);
    // Before the claim, so a withdrawn confirm leaves the token usable.
    assertNotCancelled(ctx);
    // The role is re-checked on confirm too: a token minted under one role
    // must not execute under a wider one.
    assertWritePolicy({method: action.method}, ctx.level, ctx.role ?? null);
    // Before the claim, so a refusal at the cap leaves the token usable.
    const slot = await deviceCommandSlot(ctx, action.method, 'write');
    await holdingSlotOnFailure(slot, () =>
        claimToken(String(confirmationToken), {
            issuedAtMs: action.issuedAtMs,
            expiresAtMs: action.expiresAtMs
        })
    );
    if (requiresHumanApproval(action, catalogEntry(action.method).safety)) {
        await noteApproval('approved', 'token');
    }
    return executeAndAudit(
        ctx,
        {
            tool: 'fm_confirm_write',
            method: action.method,
            params: action.params,
            idempotencyKey: action.idempotencyKey
        },
        slot
    );
}

// Preview + signed token; validates params first so no token for a bad action.
function confirmationRequired(
    method: string,
    params: Record<string, unknown>,
    caller: OperateCaller,
    reason: string,
    target?: WriteTarget,
    idempotencyKey?: string
) {
    const entry = catalogEntry(method);
    assertParamsValid(method, params, entry.paramsSchema);
    const summary = buildWriteSummary(method, params, entry.safety, target);
    const described = {
        summary: summary.title,
        ...(summary.details ? {details: summary.details} : {}),
        ...(summary.affected ? {affectedResources: summary.affected} : {})
    };
    return {
        status: 'confirmation_required' as const,
        reason,
        method,
        params,
        // A resolved target puts the device's own name into these sentences.
        ...(target ? untrustedMarker(described) : {}),
        ...described,
        reversible: summary.reversible,
        requiredPermission: entry.permission,
        destructive: entry.safety.destructiveHint,
        paramsSchema: entry.paramsSchema,
        confirmationToken: signWriteConfirmation({
            method,
            params,
            username: caller.username,
            organizationId: caller.organizationId,
            credentialId: caller.credentialId,
            idempotencyKey
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

interface GovernedWrite {
    tool: string;
    method: string;
    params: Record<string, unknown>;
    idempotencyKey?: string;
}

// Runs a write that passed policy and approval; the slot is given back once.
async function executeAndAudit(
    ctx: OperateContext,
    write: GovernedWrite,
    slot: DeviceCommandSlot
) {
    const {tool, method, params} = write;
    if (write.idempotencyKey !== undefined) {
        return executeDurably(
            ctx,
            {...write, idempotencyKey: write.idempotencyKey},
            slot
        );
    }
    const raw = await holdingSlot(slot, async () => {
        assertNotCancelled(ctx);
        await recordWriteAuditOrRefuse(ctx, tool, method);
        return ctx.execute(method, params);
    });
    // A write result used to come back untouched: unredacted, uncapped, and
    // with no summary. A freshly minted API key or a 400-row bulk result went
    // straight into the model transcript. Same bounds as a read; methods that
    // exist to hand out a secret are refused before this point.
    const envelope = buildReadEnvelope(method, raw);
    // "enqueued" not "recorded": accepted by the batched queue, not persisted.
    return {
        status: 'executed' as const,
        method,
        // What just happened, in a sentence, so the model does not have to
        // infer it from raw JSON.
        summary: buildWriteSummary(method, params, catalogEntry(method).safety)
            .title,
        ...(envelope.untrusted ? {untrusted: envelope.untrusted} : {}),
        result: envelope.result,
        truncated: envelope.truncated,
        audit: {enqueued: true}
    };
}

async function executeDurably(
    ctx: OperateContext,
    write: GovernedWrite & {idempotencyKey: string},
    slot: DeviceCommandSlot
) {
    const {tool, method, params, idempotencyKey} = write;
    const operations = ctx.operations;
    let started = false;
    try {
        assertNotCancelled(ctx);
        if (!operations)
            throw new McpError(
                'operation_unavailable',
                'Durable operation storage is unavailable'
            );
        return await executeDurableOperation({
            store: storeReleasingSlot(operations, slot, () => {
                started = true;
            }),
            caller: ctx.caller,
            method,
            params,
            idempotencyKey,
            beforeExecute: () => recordWriteAuditOrRefuse(ctx, tool, method),
            execute: (executionParams) =>
                ctx.execute(method, executionParams ?? params)
        });
    } finally {
        if (!started) await slot.release();
    }
}

// A started operation always ends in finishExecution, after its background run.
function storeReleasingSlot(
    store: OperationStore,
    slot: DeviceCommandSlot,
    onStarted: () => void
): OperationStore {
    return {
        ...store,
        start: async (input) => {
            const running = await store.start(input);
            if (running) onStarted();
            return running;
        },
        finishExecution: (input) => {
            try {
                store.finishExecution(input);
            } finally {
                void slot.release();
            }
        }
    };
}

// Only methods that reach a device count against the tenant's slots.
function deviceCommandSlot(
    ctx: OperateContext,
    method: string,
    commandClass: DeviceCommandClass
): Promise<DeviceCommandSlot> {
    if (catalogEntry(method).namespaceKind !== 'device') {
        return Promise.resolve(UNCOUNTED_DEVICE_COMMAND);
    }
    return acquireDeviceCommandSlot({
        organizationId: ctx.caller.organizationId,
        commandClass,
        method
    });
}

async function holdingSlot<T>(
    slot: DeviceCommandSlot,
    run: () => Promise<T>
): Promise<T> {
    try {
        return await run();
    } finally {
        await slot.release();
    }
}

// Keeps the slot for the command that follows, unless this step fails.
async function holdingSlotOnFailure(
    slot: DeviceCommandSlot,
    run: () => Promise<void>
): Promise<void> {
    try {
        await run();
    } catch (error) {
        await slot.release();
        throw error;
    }
}
