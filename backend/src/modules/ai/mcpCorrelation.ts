// One id shared by every audit row a single MCP tool call produces, and the
// caller's W3C trace context when it sent one.
//
// A tool call writes two kinds of row: the mcp_tool_call row at the doorway,
// and the rpc rows Commander writes for whatever the tool actually ran. They
// were unrelated, so "show me everything this one call did" had no answer.
//
// AsyncLocalStorage rather than a parameter, because the rows are written
// several layers down (MessageHandler -> Commander -> AuditLogger) by code
// that has no business knowing MCP exists.

import {AsyncLocalStorage} from 'node:async_hooks';

/** A caller's W3C Trace Context (https://www.w3.org/TR/trace-context/). */
export interface TraceContext {
    traceId: string;
    parentId: string;
    flags: string;
    tracestate?: string;
}

interface CallContext {
    correlationId: string;
    trace?: TraceContext;
}

const storage = new AsyncLocalStorage<CallContext>();

/** Runs `fn` with every audit row inside it tagged with this call. */
export function withCallContext<T>(
    call: CallContext,
    fn: () => Promise<T>
): Promise<T> {
    return storage.run(call, fn);
}

/** The current call's id, or undefined outside a tool call. */
export function currentCorrelationId(): string | undefined {
    return storage.getStore()?.correlationId;
}

/** The trace the current call joined, when its caller sent a valid one. */
export function currentTraceContext(): TraceContext | undefined {
    return storage.getStore()?.trace;
}

const VERSION_00_LENGTH = 55;
const TRACEPARENT_PREFIX =
    /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/;
const ALL_ZERO = /^0+$/;
// W3C list-member key (simple or tenant@system) and value.
const TRACESTATE_MEMBER =
    /^(?:[a-z][a-z0-9_\-*/]{0,255}|[a-z0-9][a-z0-9_\-*/]{0,240}@[a-z][a-z0-9_\-*/]{0,13})=[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/;
const MAX_TRACESTATE_MEMBERS = 32;
// The length every participant must be able to pass on (W3C section 3.3.1.5).
const MAX_TRACESTATE_LENGTH = 512;

/**
 * A traceparent per W3C Trace Context section 3.2, or undefined when it is
 * not one: an invalid value starts no trace rather than failing the call.
 * A later version is read by its version-00 fields, as section 3.2.4 asks.
 */
function readTraceparent(
    value: unknown
): Omit<TraceContext, 'tracestate'> | undefined {
    if (typeof value !== 'string') return undefined;
    const match = TRACEPARENT_PREFIX.exec(value);
    if (!match) return undefined;
    const [, version, traceId, parentId, flags] = match;
    if (version === 'ff') return undefined;
    if (version === '00' && value.length !== VERSION_00_LENGTH)
        return undefined;
    if (value.length > VERSION_00_LENGTH && value[VERSION_00_LENGTH] !== '-')
        return undefined;
    if (ALL_ZERO.test(traceId) || ALL_ZERO.test(parentId)) return undefined;
    return {traceId, parentId, flags};
}

// A tracestate per section 3.3; one that breaks the format is dropped alone.
function readTracestate(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > MAX_TRACESTATE_LENGTH)
        return undefined;
    const members = value
        .split(',')
        .map((member) => member.trim())
        .filter(Boolean);
    const keys = new Set(members.map((member) => member.split('=')[0]));
    if (
        members.length === 0 ||
        members.length > MAX_TRACESTATE_MEMBERS ||
        keys.size !== members.length ||
        !members.every((member) => TRACESTATE_MEMBER.test(member))
    )
        return undefined;
    return members.join(',');
}

/** The trace context a request carries, from its `_meta` or HTTP headers. */
export function readTraceContext(carrier: {
    traceparent?: unknown;
    tracestate?: unknown;
}): TraceContext | undefined {
    const parent = readTraceparent(carrier.traceparent);
    if (!parent) return undefined;
    const tracestate = readTracestate(carrier.tracestate);
    return tracestate ? {...parent, tracestate} : parent;
}
