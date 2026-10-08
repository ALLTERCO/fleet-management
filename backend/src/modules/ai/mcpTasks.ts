// The MCP Tasks extension (io.modelcontextprotocol/tasks, 2026-07-28 schema)
// over Fleet's durable operations. A write started with an idempotencyKey is
// already a persisted, caller-bound receipt with a status; a client that
// declares the extension gets that receipt as a task handle and polls it with
// tasks/get, instead of polling fm_get_operation. No new job engine: the task
// id is the operation id and its state is the operation's state.
//
// Specification: https://github.com/modelcontextprotocol/ext-tasks
// (specification/2026-07-28/tasks.md).

import {McpError} from './mcpErrors.js';
import type {operationEnvelope} from './operationExecution.js';
import type {OperationStatus} from './operationStore.js';

/** A durable operation as tools return it (fm_write, fm_get_operation). */
type OperationEnvelope = ReturnType<typeof operationEnvelope>;

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';

export const TASK_METHODS: ReadonlySet<string> = new Set([
    'tasks/get',
    'tasks/update',
    'tasks/cancel'
]);

// A durable write settles within the tool deadline or is reconciled; polling
// faster than this learns nothing new.
const TASK_POLL_INTERVAL_MS = 2_000;

type TaskStatus = 'working' | 'completed';

export interface Task {
    taskId: string;
    status: TaskStatus;
    statusMessage?: string;
    createdAt: string;
    lastUpdatedAt: string;
    ttlMs: number | null;
    pollIntervalMs: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a request's client capabilities declare the Tasks extension. */
export function declaresTasks(capabilities: unknown): boolean {
    if (!isPlainObject(capabilities)) return false;
    const extensions = capabilities.extensions;
    return (
        isPlainObject(extensions) && isPlainObject(extensions[TASKS_EXTENSION])
    );
}

/** The -32021 a client gets for a task method it never declared. */
export function missingTasksCapability(): McpError {
    return new McpError(
        'missing_required_client_capability',
        'Missing required client capability',
        {details: {requiredCapabilities: {extensions: {[TASKS_EXTENSION]: {}}}}}
    );
}

/** A task that does not exist for this caller: invalid params (-32602). */
export function taskNotFound(): McpError {
    return new McpError('invalid_params', 'Task not found');
}

/** The taskId of a tasks/* request, or invalid params. */
export function readTaskId(params: {taskId?: unknown} | undefined): string {
    const taskId = params?.taskId;
    if (typeof taskId !== 'string' || !taskId) throw taskNotFound();
    return taskId;
}

const UNSETTLED: ReadonlySet<OperationStatus> = new Set([
    'reserved',
    'running'
]);

// An executor that lost its lease may still record the outcome, so that
// unknown is not final yet; any other unknown is.
function settled(operation: OperationEnvelope): boolean {
    if (UNSETTLED.has(operation.status)) return false;
    return !(
        operation.status === 'outcome_unknown' &&
        operation.errorCode === 'executor_lost'
    );
}

/** Whether a tool result is a durable write still running: worth a task. */
export function isUnsettledOperation(
    value: unknown
): value is OperationEnvelope {
    return (
        isPlainObject(value) &&
        typeof value.operationId === 'string' &&
        typeof value.createdAt === 'string' &&
        UNSETTLED.has(value.status as OperationStatus)
    );
}

function ttlMsOf(operation: OperationEnvelope): number | null {
    const ttl =
        Date.parse(operation.expiresAt) - Date.parse(operation.createdAt);
    return Number.isFinite(ttl) && ttl > 0 ? ttl : null;
}

function statusMessageOf(operation: OperationEnvelope): string | undefined {
    if (operation.outcomeSummary) return operation.outcomeSummary;
    if (operation.status === 'reserved') return 'Reserved; not started yet.';
    if (operation.status === 'running') return 'The write is running.';
    return undefined;
}

/**
 * The task view of an operation. Fleet never reports failed (that status is
 * for JSON-RPC errors) or cancelled (a write in flight is not stopped): a
 * failed write completes with an isError result, as the extension requires.
 */
export function taskOf(operation: OperationEnvelope): Task {
    const statusMessage = statusMessageOf(operation);
    return {
        taskId: operation.operationId,
        status: settled(operation) ? 'completed' : 'working',
        ...(statusMessage ? {statusMessage} : {}),
        createdAt: operation.createdAt,
        lastUpdatedAt: operation.updatedAt,
        ttlMs: ttlMsOf(operation),
        pollIntervalMs: TASK_POLL_INTERVAL_MS
    };
}
